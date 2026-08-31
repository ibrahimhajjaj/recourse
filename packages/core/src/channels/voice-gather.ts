import { verifyTwilio } from './verify.js'
import { toSpeech } from './voice-speech.js'
import type { Agent } from '../agent.js'
import type { Message } from '../types.js'
import type { Store } from '../store/types.js'
import type { SpeechCache, Voice } from './voice-tts.js'

/**
 * Inbound calls without Conversation Relay.
 *
 * Relay is the better experience, but it needs Twilio onboarding, an accepted
 * AI addendum, a public WebSocket endpoint and it has its own concurrency
 * limits. This is the version that works on any Twilio account this afternoon:
 * plain TwiML, one HTTP request per turn, no socket to host.
 *
 * What you give up is real: no barge-in, and a pause after the caller stops
 * speaking while the whole answer is generated before any of it is spoken.
 * Choose this to get a phone number answering today, and move to Relay when
 * the latency starts to matter.
 */
export interface GatherVoiceOptions {
  agent: Agent
  /** Twilio's auth token, to verify webhooks. */
  authToken?: string
  /** The exact public url Twilio calls; needed behind a proxy. */
  publicUrl?: string
  insecureSkipVerification?: boolean

  /** Spoken when the call connects. */
  greeting?: string
  /** A Twilio TTS voice, such as `Polly.Amy-Neural` or `Google.en-GB-Neural2-A`. */
  voice?: string
  language?: string
  /** Terms the transcriber should expect. */
  hints?: string[]
  /** Turns kept in the model call. */
  maxHistory?: number
  /** Consecutive silences before hanging up. */
  maxSilence?: number
  /** Reads history back, so a turn knows what was already said. */
  store?: Store
  /** Where to send a caller who asks for a person. */
  transferTo?: string
  /**
   * Speaks with your own voice instead of Twilio's.
   *
   * `<Say>` is limited to Twilio's built-in voices. Supply a Voice, a clip
   * cache and the public url of the route serving it, and replies are
   * synthesised here and played instead. Falls back to `<Say>` whenever
   * synthesis fails, because a robotic answer beats silence.
   */
  tts?: {
    voice: Voice
    cache: SpeechCache
    /** Public url of your speechRoute mount, such as https://x.com/tts */
    publicBaseUrl: string
  }
}

/**
 * Handles both the first request and every turn after it.
 *
 * One handler rather than two, because Twilio posts the same shape to both and
 * a single mounted path is one less thing to get wrong in the console.
 */
export function gatherVoiceChannel(options: GatherVoiceOptions) {
  const maxHistory = options.maxHistory ?? 10
  const maxSilence = options.maxSilence ?? 2

  /** Falls back to memory when no store is configured. */
  const local = new Map<string, Message[]>()

  async function historyFor(conversationId: string): Promise<Message[]> {
    if (!options.store) return local.get(conversationId) ?? []

    const found = await options.store.getConversation(conversationId)
    return (found?.messages ?? [])
      .filter((message) => message.content.trim())
      .map((message) => ({ role: message.role, content: message.content }))
      .slice(-maxHistory)
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const rawBody = await request.text()
    const params: Record<string, string> = {}
    for (const [key, value] of new URLSearchParams(rawBody)) params[key] = value

    if (!options.insecureSkipVerification) {
      if (!options.authToken) {
        throw new Error('gatherVoiceChannel needs an authToken, or insecureSkipVerification for development')
      }
      const verified = await verifyTwilio({
        signature: request.headers.get('x-twilio-signature'),
        url: options.publicUrl ?? request.url,
        params,
        authToken: options.authToken,
      })
      if (!verified) return new Response('bad signature', { status: 401 })
    }

    const from = params.From ?? params.Caller ?? 'unknown'
    const conversationId = `phone:${from}`
    const speech = params.SpeechResult?.trim()
    const digits = params.Digits?.trim()

    // No speech and no digits means either the opening request or silence.
    if (!speech && !digits) {
      const silences = Number.parseInt(new URL(request.url).searchParams.get('silence') ?? '0', 10) || 0
      const isFirstTurn = params.CallStatus === 'ringing' || !params.SpeechResult

      if (isFirstTurn && silences === 0) {
        return twiml(
          (await speak(options, options.greeting ?? 'Hello, how can I help you today?')) +
            gather(options, request, 0),
        )
      }

      if (silences + 1 >= maxSilence) {
        const goodbye = await speak(options, 'I could not hear anything, so I will hang up now. Call back any time.')
        return twiml(`${goodbye}<Hangup/>`)
      }

      return twiml(
        (await speak(options, 'Sorry, I did not catch that.')) + gather(options, request, silences + 1),
      )
    }

    const question = speech ?? `The caller pressed ${digits}`

    let answer: string
    let handedOff = false

    try {
      const result = await options.agent.answer(question, await historyFor(conversationId), {
        conversationId,
        contact: { id: from, phone: from },
        channel: 'phone',
      })

      answer = toSpeech(result.text) || 'Sorry, I do not have an answer for that.'
      // The escalate and live-chat actions both emit a handoff; on a call the
      // only sensible response is to dial a person, if there is one to dial.
      handedOff = result.sources.length === 0 && /pass (this|you) to|take this over|connect(ing)? you/i.test(result.text)

      if (!options.store) {
        const thread = local.get(conversationId) ?? []
        thread.push({ role: 'user', content: question }, { role: 'assistant', content: answer })
        local.set(conversationId, thread.slice(-maxHistory * 2))
      }
    } catch (error) {
      console.error('[recourse] gather voice turn failed', error)
      answer = 'Sorry, something went wrong on my side.'
    }

    if (handedOff && options.transferTo) {
      const line = await speak(options, answer)
      return twiml(`${line}<Dial>${escapeXml(options.transferTo)}</Dial>`)
    }

    return twiml((await speak(options, answer)) + gather(options, request, 0))
  }
}

function gather(options: GatherVoiceOptions, request: Request, silence: number): string {
  const url = new URL(request.url)
  url.searchParams.set('silence', String(silence))

  const attributes = [
    'input="speech dtmf"',
    // `auto` lets Twilio decide when the caller has finished, which is far
    // better than a fixed timeout for open-ended questions.
    'speechTimeout="auto"',
    'speechModel="phone_call"',
    `action="${escapeXml(url.toString())}"`,
    'method="POST"',
    options.language ? `language="${escapeXml(options.language)}"` : '',
    options.hints?.length ? `hints="${escapeXml(options.hints.join(','))}"` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return `<Gather ${attributes}/>`
}

/**
 * Renders one spoken line, preferring your own voice.
 *
 * Synthesis failing is not a reason for the caller to hear nothing, so any
 * error here falls back to Twilio's own `<Say>`.
 */
async function speak(options: GatherVoiceOptions, text: string): Promise<string> {
  if (!options.tts) return say(options, text)

  try {
    const { audio, contentType } = await options.tts.voice.speak(text)
    const id = options.tts.cache.put(audio, contentType)
    const base = options.tts.publicBaseUrl.replace(/\/+$/, '')
    return `<Play>${escapeXml(`${base}/${id}`)}</Play>`
  } catch (error) {
    console.error('[recourse] falling back to Twilio Say', error)
    return say(options, text)
  }
}

function say(options: GatherVoiceOptions, text: string): string {
  const attributes = [
    options.voice ? `voice="${escapeXml(options.voice)}"` : '',
    options.language ? `language="${escapeXml(options.language)}"` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return `<Say${attributes ? ` ${attributes}` : ''}>${escapeXml(text)}</Say>`
}

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
