/**
 * Speaking with a voice you chose, on the plain-TwiML path.
 *
 * Conversation Relay already synthesises with ElevenLabs by default, so this
 * exists for the `<Gather>` channel, where `<Say>` is limited to Twilio's own
 * voices. Here the answer is synthesised ourselves and handed to `<Play>`.
 *
 * The audio is cached by id and fetched by Twilio from a route we serve, rather
 * than passing the text in the `<Play>` url. That keeps whole answers, which
 * routinely contain order numbers and names, out of Twilio's request logs, and
 * sidesteps url length limits on a long reply.
 */

export interface SpeechClip {
  audio: ArrayBuffer
  contentType: string
  expiresAt: number
}

export interface SpeechCache {
  put(audio: ArrayBuffer, contentType: string): string
  take(id: string): SpeechClip | null
}

export interface SpeechCacheOptions {
  /** How long a clip stays fetchable. Twilio fetches within seconds. */
  ttlMs?: number
  /** Upper bound on clips held, so a busy line cannot exhaust memory. */
  maxEntries?: number
}

export function createSpeechCache(options: SpeechCacheOptions = {}): SpeechCache {
  const ttlMs = options.ttlMs ?? 120_000
  const maxEntries = options.maxEntries ?? 200
  const clips = new Map<string, SpeechClip>()

  function sweep(now: number) {
    for (const [id, clip] of clips) {
      if (clip.expiresAt <= now) clips.delete(id)
    }
    // Map preserves insertion order, so the oldest goes first.
    while (clips.size > maxEntries) {
      const oldest = clips.keys().next().value
      if (oldest === undefined) break
      clips.delete(oldest)
    }
  }

  return {
    put(audio, contentType) {
      const now = Date.now()
      sweep(now)
      const id = `clip_${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`
      clips.set(id, { audio, contentType, expiresAt: now + ttlMs })
      return id
    },

    take(id) {
      const clip = clips.get(id)
      if (!clip) return null
      if (clip.expiresAt <= Date.now()) {
        clips.delete(id)
        return null
      }
      // Left in place rather than deleted: Twilio can retry a fetch, and a
      // one-shot clip would leave the caller in silence when it does.
      return clip
    },
  }
}

export interface Voice {
  name: string
  speak(text: string, signal?: AbortSignal): Promise<{ audio: ArrayBuffer; contentType: string }>
}

export interface ElevenLabsVoiceOptions {
  apiKey: string
  /** A voice id from your ElevenLabs library. */
  voiceId: string
  /**
   * Defaults to the flash model, which is the right trade on a phone call:
   * a caller notices a second of silence far more than they notice the
   * difference between flash and the multilingual model.
   */
  modelId?: string
  /**
   * Telephony is 8kHz mono, so a high bitrate is wasted bytes and latency.
   */
  outputFormat?: string
  apiBase?: string
  /** Voice settings, if you have tuned them. */
  settings?: { stability?: number; similarity_boost?: number; style?: number; use_speaker_boost?: boolean }
}

export function elevenLabsVoice(options: ElevenLabsVoiceOptions): Voice {
  const model = options.modelId ?? 'eleven_flash_v2_5'
  const format = options.outputFormat ?? 'mp3_22050_32'
  const base = options.apiBase ?? 'https://api.elevenlabs.io/v1'

  return {
    name: `elevenlabs:${options.voiceId}`,

    async speak(text, signal) {
      const response = await fetch(
        `${base}/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=${encodeURIComponent(format)}`,
        {
          method: 'POST',
          headers: { 'xi-api-key': options.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            model_id: model,
            ...(options.settings ? { voice_settings: options.settings } : {}),
          }),
          signal,
        },
      )

      if (!response.ok) {
        // The body can carry the key's permissions; keep it in the log only.
        console.error('[recourse] elevenlabs tts failed', response.status, await response.text().catch(() => ''))
        throw new Error(`speech synthesis failed (${response.status})`)
      }

      return {
        audio: await response.arrayBuffer(),
        contentType: format.startsWith('mp3') ? 'audio/mpeg' : 'audio/wav',
      }
    },
  }
}

/**
 * Any OpenAI-compatible `/audio/speech` endpoint, which covers OpenAI itself
 * and several local servers. Here so the plain-TwiML path is not tied to one
 * vendor.
 */
export interface OpenAiVoiceOptions {
  apiKey?: string
  baseURL?: string
  model?: string
  voice?: string
  format?: 'mp3' | 'wav' | 'opus'
}

export function openAiCompatibleVoice(options: OpenAiVoiceOptions = {}): Voice {
  const base = options.baseURL ?? 'https://api.openai.com/v1'
  const model = options.model ?? 'tts-1'
  const voice = options.voice ?? 'alloy'
  const format = options.format ?? 'mp3'

  return {
    name: `openai:${voice}`,

    async speak(text, signal) {
      const response = await fetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: {
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, voice, input: text, response_format: format }),
        signal,
      })

      if (!response.ok) {
        console.error('[recourse] tts failed', response.status, await response.text().catch(() => ''))
        throw new Error(`speech synthesis failed (${response.status})`)
      }

      return {
        audio: await response.arrayBuffer(),
        contentType: format === 'mp3' ? 'audio/mpeg' : format === 'wav' ? 'audio/wav' : 'audio/ogg',
      }
    },
  }
}

/**
 * Serves a cached clip to Twilio's `<Play>`.
 *
 * Mount it at the path you pass as `publicBaseUrl` to the voice channel.
 */
export function speechRoute(cache: SpeechCache) {
  return async function handle(request: Request): Promise<Response> {
    const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? ''
    const clip = cache.take(id)

    if (!clip) return new Response('not found', { status: 404 })

    return new Response(clip.audio, {
      status: 200,
      headers: {
        'Content-Type': clip.contentType,
        'Content-Length': String(clip.audio.byteLength),
        // Twilio may fetch twice; let it, but never let a proxy keep it.
        'Cache-Control': 'private, max-age=60',
      },
    })
  }
}
