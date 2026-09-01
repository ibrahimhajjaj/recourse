/**
 * One call, hosted here rather than on somebody else's platform.
 *
 * The pieces this needs already existed and were built for the phone: a
 * transcriber that takes a clip, an agent that streams an answer, a voice that
 * speaks a sentence, and a buffer that cuts streamed text on sentence
 * boundaries so speech has the right intonation. What was missing is the thing
 * that runs them in a loop against a live microphone.
 *
 * The loop is: audio arrives, the turn detector says when the caller stopped,
 * the clip goes to the transcriber, the text goes to the agent, and the answer
 * is spoken a sentence at a time as it streams rather than after it finishes.
 * Speaking early is most of what makes a call feel quick, because the caller
 * hears the first clause while the rest is still being written.
 *
 * Interrupting is the part that separates a call from a walkie-talkie. When
 * somebody talks over the agent, everything in flight is abandoned: the answer
 * being generated, the sentence being synthesised, and anything queued behind
 * it. Finishing a sentence nobody is listening to is worse than saying nothing.
 *
 * Transport is deliberately absent. This receives samples and hands back
 * audio, so the same session works over a WebSocket today and over anything
 * else later without being rewritten.
 */

import { createSentenceBuffer } from './voice-speech.js'
import { toWav } from './voice-wav.js'
import { createTurnDetector, levelOf, type TurnOptions } from './voice-turns.js'
import type { Transcriber } from './voice-stt.js'
import type { Voice } from './voice-tts.js'
import type { Message } from '../types.js'

/** What the browser is told, alongside the audio it is sent. */
export type CallMessage =
  /** The caller has started speaking. Useful for showing a level meter. */
  | { type: 'listening' }
  /** Something was said, by one side or the other. */
  | { type: 'transcript'; role: 'visitor' | 'agent'; text: string }
  /** The turn is being worked on. Nothing is audible yet. */
  | { type: 'thinking' }
  /** Audio is on its way. */
  | { type: 'speaking' }
  /** The caller talked over the agent, so anything queued is being dropped. */
  | { type: 'interrupted' }
  | { type: 'error'; message: string }

/** The half of the agent this needs, so a test can pass something small. */
export interface Answering {
  stream(question: string, history?: Message[], options?: { conversationId?: string }): AsyncIterable<{
    type: string
    text?: string
    message?: string
  }>
}

export interface CallSessionOptions {
  agent: Answering
  transcriber: Transcriber
  voice: Voice
  /** Sends a control message to the browser. */
  send: (message: CallMessage) => void
  /** Sends synthesised speech to the browser. */
  speak: (audio: ArrayBuffer, contentType: string) => void
  /** Ties the call to the conversation the chat is already using. */
  conversationId?: string
  turns?: TurnOptions
  /** Sample rate of the audio arriving, when it is not already the target. */
  sampleRate?: number
  /**
   * Spoken the moment the call connects, before the caller has said anything.
   *
   * Without one the caller hears silence and has no way to tell whether the
   * call is up, so the usual reaction is to say "hello?" twice and hang up.
   * It is interruptible like anything else: somebody who knows what they want
   * can talk straight over it.
   */
  greeting?: string
  /**
   * Longest a call may run before it is ended.
   *
   * A call with no cap is a bill with no cap. A forgotten tab with an open
   * microphone bills for speech recognition until the browser is closed, and
   * nobody notices until the invoice.
   */
  maxCallMs?: number
  /**
   * Called after each completed turn.
   *
   * The hook a business needs for the things this library should not decide:
   * what to log, what to bill, what to send to analytics.
   */
  onTurn?: (turn: { question: string; answer: string; ms: number }) => void
  /** Called once the call is over, with why it ended. */
  onEnded?: (reason: 'hangup' | 'too-long') => void
}

export interface CallSession {
  /** Starts the call. Speaks the greeting, if there is one. */
  open(): void
  /** One slice of audio from the caller. */
  push(samples: Int16Array): void
  /** Whatever has been said so far, for the transcript. */
  readonly history: Message[]
  close(): void
}

export function createCallSession(options: CallSessionOptions): CallSession {
  const detector = createTurnDetector(options.turns)
  const rate = options.sampleRate ?? 16_000
  const history: Message[] = []

  /** The current turn's audio, gathered until the caller stops. */
  let recording: Int16Array[] = []
  let closed = false
  /**
   * Cancels everything belonging to the turn being answered.
   *
   * One controller for the whole reply rather than one per sentence, because
   * an interruption abandons the answer, not just the clause being spoken.
   */
  let inFlight: AbortController | null = null
  let expiry: ReturnType<typeof setTimeout> | null = null
  let ended = false

  /** Speaks one line, cancellable, and marks the agent as talking while it does. */
  async function say(sentence: string, signal: AbortSignal) {
    if (signal.aborted || !sentence.trim()) return

    const clip = await options.voice.speak(sentence, signal)
    if (signal.aborted) return

    options.speak(clip.audio, clip.contentType)
  }

  function finish(reason: 'hangup' | 'too-long') {
    if (ended) return
    ended = true
    if (expiry) clearTimeout(expiry)
    expiry = null
    abandon()
    options.onEnded?.(reason)
  }

  function abandon() {
    inFlight?.abort()
    inFlight = null
    detector.setAgentSpeaking(false)
  }

  async function answer(clip: Int16Array) {
    const began = Date.now()
    const controller = new AbortController()
    inFlight = controller
    const mine = controller

    try {
      options.send({ type: 'thinking' })

      
      const heard = await options.transcriber.transcribe(toWav(clip, rate), {
        mimeType: 'audio/wav',
        signal: controller.signal,
      })

      const said = heard.text.trim()
      if (!said || mine.signal.aborted) return

      options.send({ type: 'transcript', role: 'visitor', text: said })
      history.push({ role: 'user', content: said })

      // Speaking starts before the answer is finished, so the caller hears the
      // opening clause while the rest is still arriving.
      const sentences = createSentenceBuffer()
      let spoken = ''
      detector.setAgentSpeaking(true)
      options.send({ type: 'speaking' })

      for await (const frame of options.agent.stream(said, history.slice(0, -1), {
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      })) {
        if (mine.signal.aborted) return

        if (frame.type === 'delta' && frame.text) {
          spoken += frame.text
          for (const sentence of sentences.push(frame.text)) await say(sentence, mine.signal)
        }

        // A handover or a refusal is a sentence the caller has to hear, and it
        // arrives on its own frame rather than as a delta.
        if (frame.type === 'handoff' && frame.message) await say(frame.message, mine.signal)
      }

      const rest = sentences.flush()
      if (rest) await say(rest, mine.signal)

      if (!mine.signal.aborted && spoken.trim()) {
        history.push({ role: 'assistant', content: spoken.trim() })
        options.send({ type: 'transcript', role: 'agent', text: spoken.trim() })
        options.onTurn?.({ question: said, answer: spoken.trim(), ms: Date.now() - began })
      }
    } catch (error) {
      // An abort is the caller interrupting, which is not a failure.
      if (mine.signal.aborted) return

      console.error('[recourse] call turn failed:', error)
      options.send({ type: 'error', message: 'Something went wrong on that answer.' })
    } finally {
      if (inFlight === mine) {
        inFlight = null
        detector.setAgentSpeaking(false)
      }
    }
  }

  return {
    history,

    open() {
      if (closed || ended) return

      if (options.maxCallMs) {
        expiry = setTimeout(() => {
          options.send({ type: 'error', message: 'This call has reached its time limit.' })
          finish('too-long')
        }, options.maxCallMs)
      }

      if (!options.greeting) return

      // Through the same path an answer takes, so it can be interrupted the
      // same way. Somebody who already knows what they want should be able to
      // talk straight over it.
      const controller = new AbortController()
      inFlight = controller
      detector.setAgentSpeaking(true)
      options.send({ type: 'speaking' })

      void say(options.greeting, controller.signal)
        .then(() => {
          if (inFlight === controller) {
            history.push({ role: 'assistant', content: options.greeting as string })
            options.send({ type: 'transcript', role: 'agent', text: options.greeting as string })
          }
        })
        .catch(() => {
          // A greeting that will not synthesise is not worth ending a call for.
        })
        .finally(() => {
          if (inFlight === controller) {
            inFlight = null
            detector.setAgentSpeaking(false)
          }
        })
    },

    push(samples: Int16Array) {
      if (closed) return

      const durationMs = (samples.length / rate) * 1000

      for (const event of detector.push(levelOf(samples), durationMs)) {
        if (event.type === 'speech-start') {
          // Deliberately does not clear what has been gathered. The detector
          // needs a couple of hundred milliseconds to be sure somebody is
          // talking, and those slices are the first syllable of the word.
          options.send({ type: 'listening' })
        }

        if (event.type === 'barge-in') {
          // Abandon the answer before anything else, so the next sentence is
          // never synthesised and never queued.
          abandon()
          options.send({ type: 'interrupted' })
        }

        if (event.type === 'turn-end') {
          const total = recording.reduce((count, part) => count + part.length, 0)
          const clip = new Int16Array(total)
          let at = 0
          for (const part of recording) {
            clip.set(part, at)
            at += part.length
          }
          recording = []

          if (clip.length > 0) void answer(clip)
        }
      }

      // Kept whether or not a turn is open, for the reason above. The cap
      // bounds a call that never stops making noise; at 20ms a slice this is
      // about thirty seconds, comfortably past the detector's own limit.
      recording.push(samples)
      if (recording.length > 1500) recording.shift()
    },

    close() {
      closed = true
      finish('hangup')
      recording = []
    },
  }
}
