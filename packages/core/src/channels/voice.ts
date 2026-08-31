import { verifyTwilio } from './verify.js'
import { createSentenceBuffer, toSpeech } from './voice-speech.js'
import type { ChannelBase } from './shared.js'
import type { Message } from '../types.js'

// ---- the TwiML endpoint -----------------------------------------------------

export interface VoiceAnswerOptions {
  /** Your WebSocket url. Must be wss://, which Twilio enforces. */
  websocketUrl: string
  /** Spoken as soon as the call connects, before the caller says anything. */
  welcomeGreeting?: string
  /** Twilio's auth token, to verify the call webhook. */
  authToken?: string
  /** The exact public url Twilio calls; needed behind a proxy for signatures. */
  publicUrl?: string
  /** Skips signature checks. Only for a local tunnel while developing. */
  insecureSkipVerification?: boolean

  language?: string
  ttsProvider?: 'Google' | 'Amazon' | 'ElevenLabs'
  voice?: string
  transcriptionProvider?: 'Google' | 'Deepgram'
  speechModel?: string
  /** Whether the caller can talk over the agent. Defaults to any. */
  interruptible?: 'none' | 'dtmf' | 'speech' | 'any'
  interruptSensitivity?: 'high' | 'medium' | 'low'
  /** Filters "uh-huh" and "yeah" so they do not cut the agent off. */
  ignoreBackchannel?: boolean
  dtmfDetection?: boolean
  /** Terms the transcriber should expect: product names, plan names, SKUs. */
  hints?: string[]
  /** Where Twilio goes when the relay session ends, for transfers. */
  actionUrl?: string
  /** Passed through to the setup message, for anything the socket needs. */
  parameters?: Record<string, string>
}

/**
 * Answers the incoming call by connecting it to Conversation Relay.
 *
 * `hints` is the cheapest quality win available here: a transcriber told to
 * expect your product names gets them right, and an agent retrieving on a
 * misheard product name answers the wrong question confidently.
 */
export function voiceChannel(options: VoiceAnswerOptions) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const rawBody = await request.text()

    if (!options.insecureSkipVerification) {
      if (!options.authToken) {
        throw new Error('voiceChannel needs an authToken, or insecureSkipVerification for local development')
      }

      const params: Record<string, string> = {}
      for (const [key, value] of new URLSearchParams(rawBody)) params[key] = value

      const verified = await verifyTwilio({
        signature: request.headers.get('x-twilio-signature'),
        url: options.publicUrl ?? request.url,
        params,
        authToken: options.authToken,
      })
      if (!verified) return new Response('bad signature', { status: 401 })
    }

    return new Response(buildTwiml(options), {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    })
  }
}

/** Escapes a value for an XML attribute. */
function attribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildTwiml(options: VoiceAnswerOptions): string {
  const attributes: Array<[string, string | undefined]> = [
    ['url', options.websocketUrl],
    ['welcomeGreeting', options.welcomeGreeting],
    ['language', options.language],
    ['ttsProvider', options.ttsProvider],
    ['voice', options.voice],
    ['transcriptionProvider', options.transcriptionProvider],
    ['speechModel', options.speechModel],
    ['interruptible', options.interruptible],
    ['interruptSensitivity', options.interruptSensitivity],
    ['ignoreBackchannel', options.ignoreBackchannel === undefined ? undefined : String(options.ignoreBackchannel)],
    ['dtmfDetection', options.dtmfDetection === undefined ? undefined : String(options.dtmfDetection)],
    ['hints', options.hints?.length ? options.hints.join(',') : undefined],
  ]

  const rendered = attributes
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([name, value]) => `${name}="${attribute(value)}"`)
    .join(' ')

  const parameters = Object.entries(options.parameters ?? {})
    .map(([name, value]) => `<Parameter name="${attribute(name)}" value="${attribute(value)}"/>`)
    .join('')

  const connect = options.actionUrl ? `<Connect action="${attribute(options.actionUrl)}">` : '<Connect>'
  const relay = parameters
    ? `<ConversationRelay ${rendered}>${parameters}</ConversationRelay>`
    : `<ConversationRelay ${rendered}/>`

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${connect}${relay}</Connect></Response>`
}

/**
 * TwiML for the `<Connect action>` callback.
 *
 * When the session ends with a live-agent handoff, this is what actually dials
 * the person. Anything else just hangs up politely.
 */
export function buildHandoffTwiml(handoffData: string | undefined, transferTo?: string): string {
  let reasonCode: string | undefined
  try {
    reasonCode = handoffData ? (JSON.parse(handoffData) as { reasonCode?: string }).reasonCode : undefined
  } catch {
    reasonCode = undefined
  }

  if (reasonCode === 'live-agent-handoff' && transferTo) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting you now.</Say><Dial>${attribute(
      transferTo,
    )}</Dial></Response>`
  }

  return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'
}

/**
 * Inbound phone calls, through Twilio's Conversation Relay.
 *
 * Relay does the speech work: it transcribes the caller, sends us text over a
 * WebSocket, and speaks the text we send back. That is why there is no
 * speech-to-text or text-to-speech provider anywhere in this file. The
 * alternative, raw Media Streams, means owning audio codecs and barge-in
 * detection for a worse result.
 *
 * The transport is deliberately not here either. Node, Deno, Bun and Workers
 * each have their own WebSocket server API, so this exposes a session that
 * consumes parsed messages and emits messages to send, and the ten lines that
 * bind it to a socket live in your app.
 */

// ---- messages from Twilio ---------------------------------------------------

export interface VoiceSetupMessage {
  type: 'setup'
  sessionId: string
  callSid: string
  from?: string
  to?: string
  direction?: string
  callerName?: string
  customParameters?: Record<string, string>
}

export interface VoicePromptMessage {
  type: 'prompt'
  voicePrompt: string
  lang?: string
  /** False for an unfinalised partial, when partialPrompts is on. */
  last: boolean
}

export interface VoiceInterruptMessage {
  type: 'interrupt'
  /** What the caller actually heard before they cut in. */
  utteranceUntilInterrupt: string
  durationUntilInterruptMs?: number
}

export interface VoiceDtmfMessage {
  type: 'dtmf'
  digit: string
}

export interface VoiceErrorMessage {
  type: 'error'
  description?: string
}

export type InboundVoiceMessage =
  | VoiceSetupMessage
  | VoicePromptMessage
  | VoiceInterruptMessage
  | VoiceDtmfMessage
  | VoiceErrorMessage

// ---- messages to Twilio -----------------------------------------------------

export type OutboundVoiceMessage =
  | { type: 'text'; token: string; last: boolean; lang?: string; interruptible?: boolean; preemptible?: boolean }
  | { type: 'play'; source: string; loop?: number; interruptible?: boolean; preemptible?: boolean }
  | { type: 'sendDigits'; digits: string }
  | { type: 'language'; ttsLanguage?: string; transcriptionLanguage?: string }
  | { type: 'end'; handoffData?: string }

// ---- the session ------------------------------------------------------------

export interface VoiceSessionOptions extends Omit<ChannelBase, 'waitUntil'> {
  /** Sends a message back down the socket. */
  send: (message: OutboundVoiceMessage) => void
  /**
   * Ends the call after this long with nothing said. Chatbase defaults to five
   * minutes and so does this; a caller who wandered off should not hold a line
   * or a model budget open indefinitely.
   */
  inactivityTimeoutMs?: number
  /** Said before hanging up on an idle call. */
  inactivityMessage?: string
  /** Turns of history kept in the model call. */
  maxHistory?: number
  /** Called when a caller presses a key, if DTMF detection is on. */
  onDtmf?: (digit: string, session: VoiceCallState) => void
  /** Called once the caller is known, for logging or a screen pop. */
  onSetup?: (session: VoiceCallState) => void
  onEnd?: (reason: string, session: VoiceCallState) => void
}

export interface VoiceCallState {
  sessionId?: string
  callSid?: string
  from?: string
  to?: string
  callerName?: string
  conversationId?: string
  customParameters?: Record<string, string>
}

export function createVoiceSession(options: VoiceSessionOptions) {
  const maxHistory = options.maxHistory ?? 10
  const inactivityMs = options.inactivityTimeoutMs ?? 300_000

  const state: VoiceCallState = {}
  const history: Message[] = []

  /** Aborts the in-flight turn when the caller talks over the agent. */
  let turn: AbortController | null = null
  /** What has actually been sent to the speaker this turn. */
  let spoken = ''
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let ended = false

  function touch() {
    if (idleTimer) clearTimeout(idleTimer)
    if (inactivityMs <= 0 || ended) return

    idleTimer = setTimeout(() => {
      const goodbye = options.inactivityMessage ?? 'I have not heard anything for a while, so I will hang up now. Call back any time.'
      options.send({ type: 'text', token: goodbye, last: true })
      end('inactivity')
    }, inactivityMs)

    if (typeof idleTimer === 'object' && 'unref' in idleTimer) idleTimer.unref()
  }

  function end(reason: string, handoffData?: Record<string, unknown>) {
    if (ended) return
    ended = true
    if (idleTimer) clearTimeout(idleTimer)
    turn?.abort()

    options.send({ type: 'end', ...(handoffData ? { handoffData: JSON.stringify(handoffData) } : {}) })
    options.onEnd?.(reason, state)
  }

  async function answer(question: string): Promise<void> {
    // A new question cancels whatever is still being said.
    turn?.abort()
    turn = new AbortController()
    const signal = turn.signal

    const sentences = createSentenceBuffer()
    spoken = ''

    try {
      const stream = options.agent.stream(question, history.slice(-maxHistory), {
        signal,
        conversationId: state.conversationId,
        contact: state.from ? { id: state.from, phone: state.from, name: state.callerName } : undefined,
        channel: 'phone',
      })

      for await (const frame of stream) {
        if (signal.aborted) return

        if (frame.type === 'delta') {
          for (const sentence of sentences.push(frame.text)) {
            spoken += `${spoken ? ' ' : ''}${sentence}`
            options.send({ type: 'text', token: `${sentence} `, last: false })
          }
        } else if (frame.type === 'handoff') {
          // The agent decided a person should take this. Hand the call back to
          // Twilio with a reason the action URL can dial on.
          const tail = sentences.flush()
          if (tail) options.send({ type: 'text', token: tail, last: true })
          end('handoff', { reasonCode: 'live-agent-handoff', reason: frame.message, ticketId: frame.ticketId })
          return
        } else if (frame.type === 'error') {
          options.send({
            type: 'text',
            token: 'Sorry, something went wrong on my side. Could you say that again?',
            last: true,
          })
          history.push({ role: 'assistant', content: '(error)' })
          touch()
          return
        }
      }

      if (signal.aborted) return

      const tail = sentences.flush()
      if (tail) {
        spoken += `${spoken ? ' ' : ''}${tail}`
        options.send({ type: 'text', token: tail, last: true })
      } else {
        // Always close the talk cycle, or Relay waits for a final token.
        options.send({ type: 'text', token: '', last: true })
      }

      history.push({ role: 'assistant', content: spoken })
    } catch (error) {
      if (signal.aborted) return
      options.onError?.(error, { channel: 'phone', conversationId: state.conversationId ?? '' })
      console.error('[recourse] voice turn failed', error)
      options.send({ type: 'text', token: 'Sorry, I could not do that just now.', last: true })
    } finally {
      touch()
    }
  }

  return {
    state,

    /** Feed every parsed message from the socket through here. */
    async handle(message: InboundVoiceMessage): Promise<void> {
      switch (message.type) {
        case 'setup': {
          state.sessionId = message.sessionId
          state.callSid = message.callSid
          state.from = message.from
          state.to = message.to
          state.callerName = message.callerName || undefined
          state.customParameters = message.customParameters
          // Keyed by caller, so somebody who rings back is the same thread.
          state.conversationId = `phone:${message.from ?? message.callSid}`
          options.onSetup?.(state)
          touch()
          return
        }

        case 'prompt': {
          // Partials arrive while the caller is still talking; only a finalised
          // turn is worth a model call.
          if (!message.last) return
          const question = message.voicePrompt?.trim()
          if (!question) return

          touch()
          history.push({ role: 'user', content: question })
          await answer(question)
          return
        }

        case 'interrupt': {
          turn?.abort()
          // The transcript records what the caller HEARD, not what we generated.
          // Otherwise the model believes it said things nobody received and
          // refers back to them.
          const heard = toSpeech(message.utteranceUntilInterrupt ?? '')
          if (heard) history.push({ role: 'assistant', content: heard })
          spoken = ''
          touch()
          return
        }

        case 'dtmf': {
          touch()
          options.onDtmf?.(message.digit, state)
          return
        }

        case 'error': {
          console.error('[recourse] conversation relay error:', message.description)
          return
        }
      }
    },

    /** Ends the call from the host side, optionally handing off. */
    end,

    /** Switches the language mid-call, for a caller who changed. */
    switchLanguage(languages: { ttsLanguage?: string; transcriptionLanguage?: string }) {
      options.send({ type: 'language', ...languages })
    },

    /** Closes timers when the socket goes away without a proper end. */
    dispose() {
      ended = true
      if (idleTimer) clearTimeout(idleTimer)
      turn?.abort()
    },

    /** Exposed for tests and logging. */
    history: () => [...history],
  }
}
