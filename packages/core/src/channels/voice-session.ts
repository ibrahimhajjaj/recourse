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
import { getLogger } from '../diagnostics.js'

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
  /**
   * A voice per language, for providers whose voices speak only one.
   *
   * Keyed by two-letter code, as the transcriber reports it: `{ ar: arabic }`.
   * A call that arrives in a language with no entry uses `voice`, so this is
   * additive and a deployment that needs one voice sets none of it.
   *
   * The reason it exists: some hosts ship a separate model per language rather
   * than one multilingual model, and the agent will happily answer in the
   * language it was asked in. Reading an Arabic sentence out of an
   * English-only voice produces sounds, not words.
   */
  voices?: Record<string, Voice>
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
   * Turns of the call kept for the model. Ten by default.
   *
   * The whole history is sent on every turn, so this is what stops a long call
   * costing more per answer the longer it goes on.
   */
  maxHistory?: number
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
  /**
   * Loudness of one slice, when the audio itself arrives compressed.
   *
   * The detector was always a function of a number and a duration rather than
   * of samples, so a client that measures its own microphone can drive it
   * without sending the microphone. That is the whole reason compressed audio
   * is possible here without decoding anything on this side.
   */
  pushLevel(level: number, durationMs: number): void
  /**
   * One chunk of compressed audio, as recorded.
   *
   * `first` marks the chunk carrying the container header. It is kept and put
   * in front of every later run, because a run of clusters on its own is not a
   * file anything can open.
   */
  pushCompressed(chunk: Uint8Array, first: boolean, mimeType: string): void
  /** Whatever has been said so far, for the transcript. */
  readonly history: Message[]
  close(): void
}

/**
 * How many turns of a call the model is reminded of.
 *
 * Ten, matching every other channel. A caller twenty minutes into a call is
 * asking about what they said a minute ago, not twenty.
 */
const DEFAULT_MAX_HISTORY = 10

export function createCallSession(options: CallSessionOptions): CallSession {
  const detector = createTurnDetector(options.turns)
  const rate = options.sampleRate ?? 16_000
  const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY
  const history: Message[] = []

  /**
   * Keeps the call's history to its last few turns.
   *
   * A call is the one conversation with no natural end to its history: nobody
   * closes a tab, they just keep talking. Every turn sends the whole thing to
   * the model, so an unbounded array makes a half-hour call cost more per turn
   * the longer it runs, and eventually stops fitting in the model at all.
   *
   * Trimmed after each push rather than sliced at the call site, so nothing has
   * to remember to do it.
   */
  const remember = (message: Message): void => {
    history.push(message)
    if (history.length > maxHistory) history.splice(0, history.length - maxHistory)
  }

  /** The current turn's audio, gathered until the caller stops. */
  let recording: Int16Array[] = []
  /** The container header, kept for the life of the call. */
  let header: Uint8Array | null = null
  /** Compressed chunks since the last turn ended. */
  let compressed: Uint8Array[] = []
  let compressedType = 'audio/webm'
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

  /**
   * The voice for this turn: the caller's language when one is configured for
   * it, and the default otherwise.
   */
  function voiceFor(language: string | undefined): Voice {
    if (!language || !options.voices) return options.voice

    return options.voices[language] ?? options.voice
  }

  /** Speaks one line, cancellable, and marks the agent as talking while it does. */
  async function say(sentence: string, signal: AbortSignal, voice: Voice = options.voice) {
    if (signal.aborted || !sentence.trim()) return

    const clip = await voice.speak(sentence, signal)
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

  async function answer(clip: { audio: Uint8Array; mimeType: string }) {
    const began = Date.now()
    const controller = new AbortController()
    inFlight = controller
    const mine = controller

    try {
      options.send({ type: 'thinking' })

      
      // Already a file: either the wav wrapped around the raw slices, or
      // exactly what the browser's own recorder produced. Both are formats a
      // transcription endpoint opens without anything being decoded here,
      // which is what lets compressed audio cross this boundary untouched.
      const heard = await options.transcriber.transcribe(clip.audio, {
        mimeType: clip.mimeType,
        signal: controller.signal,
      })

      const said = heard.text.trim()
      if (!said || mine.signal.aborted) return

      options.send({ type: 'transcript', role: 'visitor', text: said })
      remember({ role: 'user', content: said })

      // Chosen from what was actually heard rather than from a setting, so one
      // call can change language halfway through and be followed.
      const voice = voiceFor(heard.language)

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
          for (const sentence of sentences.push(frame.text)) await say(sentence, mine.signal, voice)
        }

        // A handover or a refusal is a sentence the caller has to hear, and it
        // arrives on its own frame rather than as a delta.
        if (frame.type === 'handoff' && frame.message) await say(frame.message, mine.signal, voice)
      }

      const rest = sentences.flush()
      if (rest) await say(rest, mine.signal, voice)

      if (!mine.signal.aborted && spoken.trim()) {
        remember({ role: 'assistant', content: spoken.trim() })
        options.send({ type: 'transcript', role: 'agent', text: spoken.trim() })
        options.onTurn?.({ question: said, answer: spoken.trim(), ms: Date.now() - began })
      }
    } catch (error) {
      // An abort is the caller interrupting, which is not a failure.
      if (mine.signal.aborted) return

      getLogger().error('call turn failed:', error)
      options.send({ type: 'error', message: 'Something went wrong on that answer.' })
    } finally {
      if (inFlight === mine) {
        inFlight = null
        detector.setAgentSpeaking(false)
      }
    }
  }

  /**
   * One slice of time, whatever carried it.
   *
   * Both codecs land here. The detector only ever needed how loud it was and
   * for how long, so the audio path and the decision path are separate and
   * only the audio path changes when the codec does.
   */
  function advance(level: number, durationMs: number) {
    for (const event of detector.push(level, durationMs)) {
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
        const clip = takeTurn()
        recording = []
        compressed = []

        if (clip) void answer(clip)
      }
    }
  }

  /**
   * The turn's audio, in whatever form it arrived.
   *
   * Compressed wins when there is any, because it is what the microphone
   * actually recorded; the raw slices are only kept to measure loudness when
   * the browser is sending both.
   */
  function takeTurn(): { audio: Uint8Array; mimeType: string } | null {
    if (compressed.length > 0) {
      const parts = header ? [header, ...compressed] : compressed
      const total = parts.reduce((count, part) => count + part.byteLength, 0)
      const joined = new Uint8Array(total)
      let at = 0
      for (const part of parts) {
        joined.set(part, at)
        at += part.byteLength
      }

      return { audio: joined, mimeType: compressedType }
    }

    const total = recording.reduce((count, part) => count + part.length, 0)
    if (total === 0) return null

    const clip = new Int16Array(total)
    let at = 0
    for (const part of recording) {
      clip.set(part, at)
      at += part.length
    }

    return { audio: toWav(clip, rate), mimeType: 'audio/wav' }
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
            remember({ role: 'assistant', content: options.greeting as string })
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

    pushLevel(level: number, durationMs: number) {
      if (closed) return
      advance(level, durationMs)
    },

    pushCompressed(chunk: Uint8Array, first: boolean, mimeType: string) {
      if (closed || chunk.byteLength === 0) return

      compressedType = mimeType
      if (first && !header) {
        header = chunk

        return
      }

      compressed.push(chunk)
      // Bounded like the raw buffer, so a call that never stops making noise
      // cannot grow without limit.
      if (compressed.length > 900) compressed.shift()
    },

    push(samples: Int16Array) {
      if (closed) return

      const durationMs = (samples.length / rate) * 1000
      advance(levelOf(samples), durationMs)

      // Kept whether or not a turn is open, because the detector needs a
      // couple of hundred milliseconds to be sure somebody is talking and
      // those slices are the first syllable of the word. The cap bounds a call
      // that never stops making noise; at 20ms a slice this is about thirty
      // seconds, comfortably past the detector's own limit.
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
