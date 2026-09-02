/**
 * Turning recorded audio into text.
 *
 * The mirror of `Voice` in voice-tts.ts, and it should have existed at the same
 * time: speech out was pluggable while speech in was whatever the browser
 * happened to offer.
 *
 * The browser's own recognition stays the default for the widget, because it
 * is free, needs no key and can keep the audio on the device. This is for the
 * cases it cannot cover: Firefox, a language the device has no pack for, or a
 * host who would rather pay for accuracy.
 *
 * **These run on your server, never in the widget.** A transcription key in a
 * browser bundle is a key anybody can read and spend.
 */

import { getLogger } from '../diagnostics.js'
import { redact } from '../actions/shrink.js'

export interface Transcript {
  text: string
  /**
   * Two-letter code, when the provider detected one.
   *
   * Normalised here rather than passed on raw. Providers disagree about what
   * to return for the same audio: a code from one, an English name like
   * "Arabic" from another, a capitalised name from a third. A caller routing a
   * voice on this should not have to know which one it is talking to.
   */
  language?: string
}

export interface Transcriber {
  /** Shown in logs, so a failure names which provider failed. */
  name: string
  transcribe(audio: Uint8Array, options?: TranscribeOptions): Promise<Transcript>
}

export interface TranscribeOptions {
  /** A hint, not a constraint. Providers detect the language when omitted. */
  language?: string
  /** The recording's media type, such as `audio/webm`. */
  mimeType?: string
  signal?: AbortSignal
}

export interface ElevenLabsTranscriberOptions {
  apiKey: string
  /** Their speech-to-text model. */
  modelId?: string
  apiBase?: string
}

/**
 * ElevenLabs speech to text.
 *
 * Worth the money where accuracy matters: an order number misheard by one
 * digit is a support ticket rather than an answer.
 */
export function elevenLabsTranscriber(options: ElevenLabsTranscriberOptions): Transcriber {
  const model = options.modelId ?? 'scribe_v1'
  const base = options.apiBase ?? 'https://api.elevenlabs.io/v1'

  return {
    name: 'elevenlabs',

    async transcribe(audio, transcribeOptions = {}) {
      const form = new FormData()
      form.append('file', new Blob([audio as BlobPart], { type: transcribeOptions.mimeType ?? 'audio/webm' }), 'audio.webm')
      form.append('model_id', model)
      if (transcribeOptions.language) form.append('language_code', transcribeOptions.language)

      const response = await fetch(`${base}/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': options.apiKey },
        body: form,
        ...(transcribeOptions.signal ? { signal: transcribeOptions.signal } : {}),
      })

      if (!response.ok) {
        // The body can name the key's permissions, so it stays in the log.
        getLogger().warn(`ElevenLabs transcription failed: ${response.status} ${redact(await response.text()).slice(0, 400)}`)
        throw new Error('transcription failed')
      }

      const body = (await response.json()) as { text?: string; language_code?: string }
      return { text: body.text ?? '', ...(body.language_code ? { language: body.language_code } : {}) }
    },
  }
}

export interface OpenAiTranscriberOptions {
  apiKey?: string
  /** Anything speaking the OpenAI transcription API. Whisper on your own box included. */
  baseURL?: string
  model?: string
}

/**
 * Anything with an OpenAI-compatible `/audio/transcriptions` endpoint.
 *
 * That covers OpenAI, Groq (fast and cheap for Whisper), and a local
 * `whisper.cpp` server, which is the one that costs nothing and keeps the
 * audio on hardware you own.
 */
export function openAiCompatibleTranscriber(options: OpenAiTranscriberOptions = {}): Transcriber {
  const base = options.baseURL ?? 'https://api.openai.com/v1'
  const model = options.model ?? 'whisper-1'

  return {
    name: 'openai-compatible',

    async transcribe(audio, transcribeOptions = {}) {
      const form = new FormData()
      form.append('file', new Blob([audio as BlobPart], { type: transcribeOptions.mimeType ?? 'audio/webm' }), 'audio.webm')
      form.append('model', model)
      if (transcribeOptions.language) form.append('language', transcribeOptions.language)
      // The plain `json` format returns the text and nothing else, so the
      // detected language was always undefined and anything routing on it,
      // such as picking a voice that can pronounce the reply, silently got the
      // default. Asking for the verbose form costs nothing and answers it.
      form.append('response_format', 'verbose_json')

      const response = await fetch(`${base.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
        body: form,
        ...(transcribeOptions.signal ? { signal: transcribeOptions.signal } : {}),
      })

      if (!response.ok) {
        getLogger().warn(`transcription failed: ${response.status} ${redact(await response.text()).slice(0, 400)}`)
        throw new Error('transcription failed')
      }

      const body = (await response.json()) as { text?: string; language?: string }
      const language = asCode(body.language)

      return { text: body.text ?? '', ...(language ? { language } : {}) }
    },
  }
}

/**
 * A two-letter code, from whatever the provider felt like returning.
 *
 * Whisper behind an OpenAI-compatible endpoint answers with an English name.
 * Others answer with a code. Both arrive here and one thing leaves.
 */
function asCode(reported: string | undefined): string | undefined {
  if (!reported) return undefined

  const value = reported.trim().toLowerCase()
  if (!value) return undefined

  // Already a code, with or without a region: "ar", "ar-SA", "zh-Hans".
  if (/^[a-z]{2,3}([-_]|$)/.test(value) && value.length <= 3) return value.slice(0, 2)
  if (/^[a-z]{2}[-_]/.test(value)) return value.slice(0, 2)

  return NAMES[value]
}

/**
 * The languages a support line actually receives, by the name Whisper gives
 * them. An unlisted one falls through to undefined, which reads as "no idea"
 * and leaves the caller on its default rather than guessing wrongly.
 */
const NAMES: Record<string, string> = {
  english: 'en',
  arabic: 'ar',
  french: 'fr',
  spanish: 'es',
  german: 'de',
  portuguese: 'pt',
  italian: 'it',
  dutch: 'nl',
  turkish: 'tr',
  russian: 'ru',
  polish: 'pl',
  swedish: 'sv',
  danish: 'da',
  norwegian: 'no',
  finnish: 'fi',
  greek: 'el',
  hebrew: 'he',
  persian: 'fa',
  urdu: 'ur',
  indonesian: 'id',
  malay: 'ms',
  vietnamese: 'vi',
  thai: 'th',
  chinese: 'zh',
  mandarin: 'zh',
  cantonese: 'yue',
  japanese: 'ja',
  korean: 'ko',
  ukrainian: 'uk',
  czech: 'cs',
  romanian: 'ro',
  hungarian: 'hu',
}

export interface TranscriptionRouteOptions {
  transcriber: Transcriber
  /** Largest recording accepted, in bytes. Ten megabytes by default. */
  maxBytes?: number
  /** Media types accepted. What browsers actually record, by default. */
  allow?: string[]
  /** Refuses a caller sending recordings faster than a person could speak. */
  rateLimit?: { check(key: string): { ok: boolean } | Promise<{ ok: boolean }> }
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_ALLOWED = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav']

/**
 * The endpoint the widget posts a recording to.
 *
 * Server-side on purpose. The alternative is the browser calling a provider
 * directly, which means the key is in the bundle.
 *
 * Transcription is billed per second of audio, so this is a a paid endpoint
 * behind a public URL. Every limit here exists because of that.
 */
export function transcriptionRoute(options: TranscriptionRouteOptions) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const allow = options.allow ?? DEFAULT_ALLOWED

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405)
    }

    if (options.rateLimit) {
      const caller = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
      const gate = await options.rateLimit.check(caller)
      if (!gate.ok) return json({ error: 'too many requests' }, 429)
    }

    const mimeType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    if (!allow.includes(mimeType)) {
      return json({ error: 'that audio format is not accepted' }, 415)
    }

    // Checked before reading, so an oversized body is refused rather than
    // buffered. A missing length still gets checked after the read.
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > maxBytes) {
      return json({ error: 'that recording is too long' }, 413)
    }

    const audio = new Uint8Array(await request.arrayBuffer())
    if (audio.byteLength === 0) return json({ error: 'the recording was empty' }, 400)
    if (audio.byteLength > maxBytes) return json({ error: 'that recording is too long' }, 413)

    try {
      const language = new URL(request.url).searchParams.get('lang') ?? undefined
      const transcript = await options.transcriber.transcribe(audio, {
        mimeType,
        ...(language ? { language } : {}),
      })
      return json(transcript, 200)
    } catch {
      // The provider's message can carry key details, and it has already been
      // logged by the transcriber.
      return json({ error: 'could not transcribe that' }, 502)
    }
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
