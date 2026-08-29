import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  elevenLabsTranscriber,
  openAiCompatibleTranscriber,
  transcriptionRoute,
  type Transcriber,
} from '../src/channels/voice-stt.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Captures the outgoing request so the wire format can be asserted. */
function captureFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(typeof response === 'string' ? response : JSON.stringify(response), { status })
    }),
  )
  return calls
}

const audio = new Uint8Array([1, 2, 3, 4])

describe('ElevenLabs', () => {
  it('posts the recording and returns the text', async () => {
    const calls = captureFetch({ text: 'where is my order', language_code: 'en' })
    const result = await elevenLabsTranscriber({ apiKey: 'xi-test' }).transcribe(audio)

    expect(result).toEqual({ text: 'where is my order', language: 'en' })
    expect(calls[0]?.url).toContain('/speech-to-text')
    expect((calls[0]?.init.headers as Record<string, string>)['xi-api-key']).toBe('xi-test')
    expect(calls[0]?.init.body).toBeInstanceOf(FormData)
  })

  it('passes a language hint when given one', async () => {
    const calls = captureFetch({ text: 'أين طلبي' })
    await elevenLabsTranscriber({ apiKey: 'k' }).transcribe(audio, { language: 'ar' })

    expect((calls[0]?.init.body as FormData).get('language_code')).toBe('ar')
  })

  it('keeps the provider body out of the thrown error', async () => {
    // The response can name what the key is permitted to do.
    captureFetch('{"detail":"api key missing permission text_to_speech"}', 401)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(elevenLabsTranscriber({ apiKey: 'k' }).transcribe(audio)).rejects.toThrow('transcription failed')

    expect(warn.mock.calls.flat().join(' ')).toContain('permission')
    warn.mockRestore()
  })
})

describe('anything OpenAI-compatible', () => {
  it('posts to /audio/transcriptions', async () => {
    const calls = captureFetch({ text: 'hello' })
    await openAiCompatibleTranscriber({ apiKey: 'sk-test' }).transcribe(audio)

    expect(calls[0]?.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('takes a local endpoint with no key at all', async () => {
    // whisper.cpp on your own hardware: free, and the audio never leaves it.
    const calls = captureFetch({ text: 'hello' })
    await openAiCompatibleTranscriber({ baseURL: 'http://localhost:8080/v1/' }).transcribe(audio)

    expect(calls[0]?.url).toBe('http://localhost:8080/v1/audio/transcriptions')
    expect(calls[0]?.init.headers).toEqual({})
  })
})

describe('the endpoint the widget posts to', () => {
  const stub: Transcriber = {
    name: 'stub',
    async transcribe(bytes, options) {
      return { text: `heard ${bytes.byteLength} bytes as ${options?.mimeType}` }
    },
  }

  function post(body: BodyInit, headers: Record<string, string> = {}, url = 'https://example.com/api/transcribe') {
    return new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', ...headers },
      body,
    })
  }

  it('transcribes an accepted recording', async () => {
    const response = await transcriptionRoute({ transcriber: stub })(post(audio))

    expect(response.status).toBe(200)
    expect((await response.json()).text).toContain('4 bytes as audio/webm')
  })

  it('refuses a format nobody records in', async () => {
    const response = await transcriptionRoute({ transcriber: stub })(
      post(audio, { 'Content-Type': 'application/zip' }),
    )
    expect(response.status).toBe(415)
  })

  it('refuses an oversized recording before reading it', async () => {
    // Transcription is billed per second of audio. A large body should be
    // turned away on its declared length, not after buffering it.
    const response = await transcriptionRoute({ transcriber: stub, maxBytes: 10 })(
      post(audio, { 'content-length': '999999' }),
    )
    expect(response.status).toBe(413)
  })

  it('refuses an oversized recording that lied about its length', async () => {
    const big = new Uint8Array(64)
    const response = await transcriptionRoute({ transcriber: stub, maxBytes: 10 })(post(big))
    expect(response.status).toBe(413)
  })

  it('refuses an empty one', async () => {
    const response = await transcriptionRoute({ transcriber: stub })(post(new Uint8Array()))
    expect(response.status).toBe(400)
  })

  it('honours a rate limiter, because this endpoint costs money per call', async () => {
    const response = await transcriptionRoute({
      transcriber: stub,
      rateLimit: { check: () => ({ ok: false }) },
    })(post(audio, { 'x-forwarded-for': '203.0.113.5' }))

    expect(response.status).toBe(429)
  })

  it('passes the language from the query string', async () => {
    let seen: string | undefined
    const route = transcriptionRoute({
      transcriber: {
        name: 'spy',
        async transcribe(_bytes, options) {
          seen = options?.language
          return { text: '' }
        },
      },
    })

    await route(post(audio, {}, 'https://example.com/api/transcribe?lang=ar'))
    expect(seen).toBe('ar')
  })

  it('does not leak the provider error to the caller', async () => {
    const route = transcriptionRoute({
      transcriber: {
        name: 'broken',
        async transcribe() {
          throw new Error('invalid api key sk-live-abc123')
        },
      },
    })

    const response = await route(post(audio))
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('sk-live')
  })

  it('refuses anything that is not a POST', async () => {
    const response = await transcriptionRoute({ transcriber: stub })(
      new Request('https://example.com/api/transcribe'),
    )
    expect(response.status).toBe(405)
  })
})
