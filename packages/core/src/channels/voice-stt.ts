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

export interface Transcript {
  text: string
  /** BCP-47, when the provider detected one. */
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
        console.warn(`[recourse] ElevenLabs transcription failed: ${response.status} ${await response.text()}`)
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

      const response = await fetch(`${base.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
        body: form,
        ...(transcribeOptions.signal ? { signal: transcribeOptions.signal } : {}),
      })

      if (!response.ok) {
        console.warn(`[recourse] transcription failed: ${response.status} ${await response.text()}`)
        throw new Error('transcription failed')
      }

      const body = (await response.json()) as { text?: string; language?: string }
      return { text: body.text ?? '', ...(body.language ? { language: body.language } : {}) }
    },
  }
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
