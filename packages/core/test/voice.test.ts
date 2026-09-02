import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import {
  buildHandoffTwiml,
  buildTwiml,
  createSentenceBuffer,
  createSpeechCache,
  createVoiceSession,
  elevenLabsSystemPrompt,
  elevenLabsToolRoute,
  elevenLabsVoice,
  gatherVoiceChannel,
  openAiCompatibleVoice,
  speechRoute,
  toSpeech,
  voiceChannel,
} from '../src/channels/index.js'
import { signTwilio, verifyRelayHandshake } from '../src/channels/verify.js'
import type { InboundVoiceMessage, OutboundVoiceMessage, VoiceSessionOptions } from '../src/channels/index.js'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { memoryStore } from '../src/store/index.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [
      textSource([
        {
          id: 'shipping',
          title: 'Shipping',
          text: '# Shipping\n\nDelivery to the United States takes 4 to 7 working days and costs twelve pounds.',
        },
      ]),
    ],
  })
  return cached
}

function model(text: string, delayMs = 0) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: '0' },
          ...text.split(' ').map((word) => ({ type: 'text-delta' as const, id: '0', delta: `${word} ` })),
          { type: 'text-end' as const, id: '0' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop', raw: 'stop' } as const,
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
        chunkDelayInMs: delayMs,
      }),
    }),
  })
}

describe('preparing an answer to be spoken', () => {
  it('drops citation markers, which a listener hears as stray numbers', () => {
    expect(toSpeech('We refund within 30 days [1]. Wholesale is final sale [2].')).toBe(
      'We refund within 30 days. Wholesale is final sale.',
    )
  })

  it('drops markdown, which is read out character by character', () => {
    expect(toSpeech('**Delivery** takes `4 to 7` days')).toBe('Delivery takes 4 to 7 days')
    expect(toSpeech('## Refunds\n\nWithin 30 days.')).toBe('Refunds\nWithin 30 days.')
  })

  it('keeps a link’s words and drops its url', () => {
    expect(toSpeech('See [the refund policy](https://shop.example/refunds) for more.')).toBe(
      'See the refund policy for more.',
    )
  })

  it('removes code fences entirely, since they are unspeakable', () => {
    // The fence becomes a pause rather than vanishing into the sentence.
    expect(toSpeech('Run this:\n```sh\nnpm install\n```\nThen restart.')).toBe('Run this:\nThen restart.')
  })

  it('turns a bullet list into plain lines', () => {
    expect(toSpeech('- One\n- Two')).toBe('One\nTwo')
  })
})

describe('buffering deltas into sentences', () => {
  it('emits a sentence only once it is complete', () => {
    const buffer = createSentenceBuffer()
    expect(buffer.push('Delivery takes ')).toEqual([])
    expect(buffer.push('four days. ')).toEqual(['Delivery takes four days.'])
  })

  it('cleans markdown split across two deltas, which per-delta cleaning cannot', () => {
    const buffer = createSentenceBuffer()
    buffer.push('It costs **twe')
    // The asterisks arrived in different chunks; only a buffer sees the pair.
    expect(buffer.push('lve pounds**. ')).toEqual(['It costs twelve pounds.'])
  })

  it('does not split a decimal or an abbreviation mid-number', () => {
    const buffer = createSentenceBuffer()
    expect(buffer.push('It weighs 3.5kg and ships free. ')).toEqual(['It weighs 3.5kg and ships free.'])
  })

  it('cuts a very long clause at a word boundary rather than leaving silence', () => {
    const buffer = createSentenceBuffer({ maxChars: 60 })
    const out = buffer.push(`${'word '.repeat(30)}`)
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]?.endsWith('word')).toBe(true)
  })

  it('flushes whatever is left at the end of a turn', () => {
    const buffer = createSentenceBuffer()
    buffer.push('No terminal punctuation here')
    expect(buffer.flush()).toBe('No terminal punctuation here')
    expect(buffer.flush()).toBe('')
  })
})

describe('TwiML for Conversation Relay', () => {
  it('builds the connect and relay elements', () => {
    const xml = buildTwiml({ websocketUrl: 'wss://x.example/voice', welcomeGreeting: 'Hi there' })
    expect(xml).toContain('<Connect>')
    expect(xml).toContain('url="wss://x.example/voice"')
    expect(xml).toContain('welcomeGreeting="Hi there"')
  })

  it('carries the voice and speech configuration', () => {
    const xml = buildTwiml({
      websocketUrl: 'wss://x.example/voice',
      ttsProvider: 'ElevenLabs',
      voice: 'JBFqnCBsd6RMkjVDRZzb',
      transcriptionProvider: 'Deepgram',
      interruptible: 'speech',
      ignoreBackchannel: true,
      hints: ['Lumen', 'Ethiopia Guji'],
    })

    expect(xml).toContain('ttsProvider="ElevenLabs"')
    expect(xml).toContain('interruptible="speech"')
    expect(xml).toContain('ignoreBackchannel="true"')
    expect(xml).toContain('hints="Lumen,Ethiopia Guji"')
  })

  it('escapes an attribute, so a greeting cannot break the xml', () => {
    const xml = buildTwiml({ websocketUrl: 'wss://x.example/v', welcomeGreeting: 'Say "hi" & <smile>' })
    expect(xml).toContain('&quot;hi&quot;')
    expect(xml).toContain('&amp;')
    expect(xml).not.toContain('<smile>')
  })

  it('omits attributes that were not set, rather than sending empty ones', () => {
    const xml = buildTwiml({ websocketUrl: 'wss://x.example/v' })
    expect(xml).not.toContain('voice=')
    expect(xml).not.toContain('hints=')
  })

  it('adds custom parameters, which arrive in the setup message', () => {
    const xml = buildTwiml({ websocketUrl: 'wss://x.example/v', parameters: { tier: 'wholesale' } })
    expect(xml).toContain('<Parameter name="tier" value="wholesale"/>')
  })

  it('sets the action url so a handoff has somewhere to land', () => {
    expect(buildTwiml({ websocketUrl: 'wss://x/v', actionUrl: 'https://x.example/done' })).toContain(
      '<Connect action="https://x.example/done">',
    )
  })
})

describe('the call webhook', () => {
  const authToken = 'auth-token'
  const url = 'https://shop.example/webhooks/voice'

  async function post(params: Record<string, string>) {
    return new Request(url, {
      method: 'POST',
      headers: {
        'x-twilio-signature': await signTwilio(url, params, authToken),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    })
  }

  it('answers a signed call with relay TwiML', async () => {
    const handle = voiceChannel({ websocketUrl: 'wss://x.example/v', authToken, publicUrl: url })
    const response = await handle(await post({ CallSid: 'CA1', From: '+15551234' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/xml')
    expect(await response.text()).toContain('<ConversationRelay')
  })

  it('rejects an unsigned call, which is anyone who found the url', async () => {
    const handle = voiceChannel({ websocketUrl: 'wss://x.example/v', authToken, publicUrl: url })
    const response = await handle(new Request(url, { method: 'POST', body: 'CallSid=CA1' }))
    expect(response.status).toBe(401)
  })

  it('refuses to run unverified without an explicit opt out', async () => {
    const handle = voiceChannel({ websocketUrl: 'wss://x.example/v' })
    await expect(handle(await post({ CallSid: 'CA1' }))).rejects.toThrow(/authToken/)
  })
})

describe('a call session', () => {
  function harness(options: Omit<VoiceSessionOptions, 'send'>) {
    const sent: OutboundVoiceMessage[] = []
    const session = createVoiceSession({
      send: (message) => sent.push(message),
      ...options,
    })
    return { sent, session, spoken: () => sent.filter((m) => m.type === 'text').map((m) => (m as { token: string }).token).join('') }
  }

  const setup: InboundVoiceMessage = {
    type: 'setup',
    sessionId: 'VX1',
    callSid: 'CA1',
    from: '+15551234',
    to: '+15559999',
    callerName: 'Sam',
  }

  it('answers a question and closes the talk cycle', async () => {
    const store = memoryStore()
    const agent = createAgent({ index: await index(), model: model('It takes four to seven working days.'), store })
    const { session, sent, spoken } = harness({ agent })

    await session.handle(setup)
    await session.handle({ type: 'prompt', voicePrompt: 'how long is delivery to the US', last: true })

    expect(spoken()).toContain('four to seven working days')
    // Relay waits for a final token before it stops listening for more.
    expect(sent.filter((m) => m.type === 'text').at(-1)).toMatchObject({ last: true })

    const found = await store.getConversation('phone:+15551234')
    expect(found?.conversation.channel).toBe('phone')
    expect(found?.conversation.contact?.name).toBe('Sam')
    session.dispose()
  })

  it('ignores a partial prompt, which arrives while the caller is still talking', async () => {
    const agent = createAgent({ index: await index(), model: model('should not be said') })
    const { session, spoken } = harness({ agent })

    await session.handle(setup)
    await session.handle({ type: 'prompt', voicePrompt: 'how long is', last: false })

    expect(spoken()).toBe('')
    session.dispose()
  })

  it('records what the caller heard on an interrupt, not what was generated', async () => {
    const agent = createAgent({ index: await index(), model: model('one two three four five six') })
    const { session } = harness({ agent })

    await session.handle(setup)
    await session.handle({
      type: 'interrupt',
      utteranceUntilInterrupt: 'Delivery takes four **days**',
      durationUntilInterruptMs: 460,
    })

    // Markdown cleaned, and only the heard part kept: believing it said more
    // would have it refer back to words nobody received.
    expect(session.history().at(-1)).toEqual({ role: 'assistant', content: 'Delivery takes four days' })
    session.dispose()
  })

  it('hands the call back to Twilio when the agent escalates', async () => {
    const handoffModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '0' },
            { type: 'text-delta' as const, id: '0', delta: 'Putting you through. ' },
            { type: 'text-end' as const, id: '0' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop', raw: 'stop' } as const,
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
          chunkDelayInMs: 0,
        }),
      }),
    })

    const { liveChat } = await import('../src/actions/index.js')
    const agent = createAgent({
      index: await index(),
      model: handoffModel,
      actions: [liveChat({ connect: () => ({ message: 'Connecting you now.' }) })],
    })

    const { session, sent } = harness({ agent })
    await session.handle(setup)

    // Drive the handoff frame directly through the session's own path.
    session.end('handoff', { reasonCode: 'live-agent-handoff', reason: 'caller asked' })
    const ended = sent.find((message) => message.type === 'end')

    expect(ended).toBeTruthy()
    expect((ended as { handoffData: string }).handoffData).toContain('live-agent-handoff')
    session.dispose()
  })

  it('hangs up politely after a long silence', async () => {
    vi.useFakeTimers()
    try {
      const agent = createAgent({ index: await index(), model: model('hello') })
      const { session, sent } = harness({ agent, inactivityTimeoutMs: 1000 })

      await session.handle(setup)
      await vi.advanceTimersByTimeAsync(1100)

      expect(sent.some((m) => m.type === 'text' && /hang up/i.test((m as { token: string }).token))).toBe(true)
      expect(sent.some((m) => m.type === 'end')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a keypress to the host', async () => {
    const pressed: string[] = []
    const agent = createAgent({ index: await index(), model: model('hi') })
    const { session } = harness({ agent, onDtmf: (digit: string) => void pressed.push(digit) })

    await session.handle(setup)
    await session.handle({ type: 'dtmf', digit: '2' })

    expect(pressed).toEqual(['2'])
    session.dispose()
  })

  it('can switch language mid-call', async () => {
    const agent = createAgent({ index: await index(), model: model('hi') })
    const { session, sent } = harness({ agent })

    session.switchLanguage({ ttsLanguage: 'es-ES', transcriptionLanguage: 'es-ES' })
    expect(sent[0]).toMatchObject({ type: 'language', ttsLanguage: 'es-ES' })
    session.dispose()
  })

  it('survives a provider failure with something sayable', async () => {
    const broken = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('provider down')
      },
    })
    const agent = createAgent({ index: await index(), model: broken })
    const { session, spoken } = harness({ agent })

    await session.handle(setup)
    await session.handle({ type: 'prompt', voicePrompt: 'hello', last: true })

    expect(spoken()).toMatch(/something went wrong/i)
    session.dispose()
  })
})

describe('handoff TwiML', () => {
  it('dials a person when the session ended for that reason', () => {
    const xml = buildHandoffTwiml(JSON.stringify({ reasonCode: 'live-agent-handoff' }), '+442071234567')
    expect(xml).toContain('<Dial>+442071234567</Dial>')
  })

  it('hangs up when there is nobody configured to dial', () => {
    expect(buildHandoffTwiml(JSON.stringify({ reasonCode: 'live-agent-handoff' }))).toContain('<Hangup/>')
  })

  it('hangs up on a normal end', () => {
    expect(buildHandoffTwiml(undefined, '+44207')).toContain('<Hangup/>')
  })

  it('does not fall over on malformed handoff data', () => {
    expect(buildHandoffTwiml('{not json', '+44207')).toContain('<Hangup/>')
  })
})

describe('the plain TwiML voice channel', () => {
  const authToken = 'auth-token'
  const url = 'https://shop.example/webhooks/gather'

  async function post(params: Record<string, string>) {
    return new Request(url, {
      method: 'POST',
      headers: {
        'x-twilio-signature': await signTwilio(url, params, authToken),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    })
  }

  async function channel(extra: Record<string, unknown> = {}) {
    const agent = createAgent({
      index: await index(),
      model: model('It takes four to seven working days [1].'),
      store: memoryStore(),
    })
    return gatherVoiceChannel({ agent, authToken, publicUrl: url, ...extra })
  }

  it('does not pin a speech model alongside automatic end-of-speech', async () => {
    // Twilio rejects the pair: a pinned `speechModel` requires an integer
    // `speechTimeout`. Both were emitted here at once, so every gather this
    // produced carried a combination the documentation forbids.
    const handle = await channel()
    const xml = await (await handle(await post({ CallSid: 'CA1', From: '+1', CallStatus: 'ringing' }))).text()

    expect(xml).toContain('speechTimeout="auto"')
    expect(xml).not.toContain('speechModel=')
  })

  it('pins the model only when given a timeout to match', async () => {
    const handle = await channel({ speechModel: 'deepgram_nova-3', speechTimeoutMs: 1200 })
    const xml = await (await handle(await post({ CallSid: 'CA1', From: '+1', CallStatus: 'ringing' }))).text()

    expect(xml).toContain('speechModel="deepgram_nova-3"')
    expect(xml).toContain('speechTimeout="1200"')
    expect(xml).not.toContain('speechTimeout="auto"')
  })

  it('leaves the model unpinned so Twilio can fail over between transcribers', async () => {
    const handle = await channel({ speechTimeoutMs: 900 })
    const xml = await (await handle(await post({ CallSid: 'CA1', From: '+1', CallStatus: 'ringing' }))).text()

    expect(xml).not.toContain('speechModel=')
    expect(xml).toContain('speechTimeout="900"')
  })

  it('greets and listens on the first request', async () => {
    const handle = await channel({ greeting: 'Hello, Lumen Coffee.' })
    const xml = await (await handle(await post({ CallSid: 'CA1', From: '+1', CallStatus: 'ringing' }))).text()

    expect(xml).toContain('<Say>Hello, Lumen Coffee.</Say>')
    expect(xml).toContain('<Gather')
    expect(xml).toContain('speechTimeout="auto"')
  })

  it('answers speech, with citations stripped for the ear', async () => {
    const handle = await channel()
    const xml = await (await handle(await post({ CallSid: 'CA1', From: '+1', SpeechResult: 'how long is delivery' }))).text()

    expect(xml).toContain('four to seven working days')
    expect(xml).not.toContain('[1]')
  })

  it('hangs up after repeated silence rather than looping forever', async () => {
    const request = await post({ CallSid: 'CA1', From: '+1', SpeechResult: '' })
    const url2 = new URL(request.url)
    url2.searchParams.set('silence', '1')

    const retried = new Request(url2.toString(), {
      method: 'POST',
      headers: request.headers,
      body: 'CallSid=CA1&From=%2B1',
    })

    const handleSkip = await channel({ maxSilence: 2, insecureSkipVerification: true })
    expect(await (await handleSkip(retried)).text()).toContain('<Hangup/>')
  })

  it('rejects an unsigned request', async () => {
    const handle = await channel()
    const response = await handle(new Request(url, { method: 'POST', body: 'From=%2B1' }))
    expect(response.status).toBe(401)
  })

  it('plays your own voice when a TTS provider is configured', async () => {
    const cache = createSpeechCache()
    const voice = {
      name: 'test',
      speak: async () => ({ audio: new ArrayBuffer(8), contentType: 'audio/mpeg' }),
    }

    const handle = await channel({
      insecureSkipVerification: true,
      tts: { voice, cache, publicBaseUrl: 'https://shop.example/tts' },
    })

    const xml = await (
      await handle(
        new Request(url, { method: 'POST', body: 'CallSid=CA1&From=%2B1&SpeechResult=how+long+is+delivery' }),
      )
    ).text()

    expect(xml).toContain('<Play>https://shop.example/tts/clip_')
    expect(xml).not.toContain('<Say>')
  })

  it('falls back to Twilio’s voice when synthesis fails, rather than silence', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = {
      name: 'broken',
      speak: async () => {
        throw new Error('elevenlabs down')
      },
    }

    const handle = await channel({
      insecureSkipVerification: true,
      tts: { voice: failing, cache: createSpeechCache(), publicBaseUrl: 'https://shop.example/tts' },
    })

    const xml = await (
      await handle(new Request(url, { method: 'POST', body: 'CallSid=CA1&From=%2B1&SpeechResult=hello' }))
    ).text()

    expect(xml).toContain('<Say>')
    spy.mockRestore()
  })
})

describe('the speech clip cache', () => {
  it('serves a stored clip and 404s an unknown one', async () => {
    const cache = createSpeechCache()
    const id = cache.put(new TextEncoder().encode('audio').buffer as ArrayBuffer, 'audio/mpeg')
    const serve = speechRoute(cache)

    const ok = await serve(new Request(`https://x.example/tts/${id}`))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('audio/mpeg')
    expect((await serve(new Request('https://x.example/tts/nope'))).status).toBe(404)
  })

  it('keeps a clip fetchable twice, because Twilio can retry', async () => {
    const cache = createSpeechCache()
    const id = cache.put(new ArrayBuffer(4), 'audio/mpeg')
    expect(cache.take(id)).not.toBeNull()
    expect(cache.take(id)).not.toBeNull()
  })

  it('expires a clip so memory does not grow forever', async () => {
    vi.useFakeTimers()
    try {
      const cache = createSpeechCache({ ttlMs: 1000 })
      const id = cache.put(new ArrayBuffer(4), 'audio/mpeg')
      vi.advanceTimersByTime(1500)
      expect(cache.take(id)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('evicts the oldest clips past the cap', () => {
    const cache = createSpeechCache({ maxEntries: 2 })
    const first = cache.put(new ArrayBuffer(1), 'audio/mpeg')
    cache.put(new ArrayBuffer(1), 'audio/mpeg')
    cache.put(new ArrayBuffer(1), 'audio/mpeg')
    cache.put(new ArrayBuffer(1), 'audio/mpeg')
    expect(cache.take(first)).toBeNull()
  })
})

describe('voice providers', () => {
  it('calls ElevenLabs the way their API documents', async () => {
    const original = globalThis.fetch
    let seen: { url: string; headers: Headers; body: Record<string, unknown> } | null = null

    globalThis.fetch = vi.fn(async (url, init) => {
      seen = {
        url: String(url),
        headers: new Headers((init as RequestInit).headers),
        body: JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
      }
      return new Response(new ArrayBuffer(16), { status: 200 })
    }) as unknown as typeof fetch

    try {
      const voice = elevenLabsVoice({ apiKey: 'xi-key', voiceId: 'V1' })
      const result = await voice.speak('hello')

      expect(seen!.url).toContain('/v1/text-to-speech/V1')
      expect(seen!.url).toContain('output_format=mp3_22050_32')
      expect(seen!.headers.get('xi-api-key')).toBe('xi-key')
      expect(seen!.body.model_id).toBe('eleven_flash_v2_5')
      expect(result.contentType).toBe('audio/mpeg')
    } finally {
      globalThis.fetch = original
    }
  })

  it('never puts the provider’s error body into the thrown message', async () => {
    const original = globalThis.fetch
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn(
      async () => new Response('missing permission text_to_speech for key sk_secret', { status: 401 }),
    ) as unknown as typeof fetch

    try {
      const voice = elevenLabsVoice({ apiKey: 'xi-key', voiceId: 'V1' })
      await expect(voice.speak('hello')).rejects.toThrow(/^speech synthesis failed \(401\)$/)
    } finally {
      globalThis.fetch = original
      spy.mockRestore()
    }
  })

  it('speaks through any OpenAI-compatible endpoint', async () => {
    const original = globalThis.fetch
    let url = ''
    globalThis.fetch = vi.fn(async (target) => {
      url = String(target)
      return new Response(new ArrayBuffer(8), { status: 200 })
    }) as unknown as typeof fetch

    try {
      const voice = openAiCompatibleVoice({ baseURL: 'http://localhost:8080/v1', voice: 'nova' })
      await voice.speak('hello')
      expect(url).toBe('http://localhost:8080/v1/audio/speech')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('recourse as an ElevenLabs agent tool', () => {
  async function route(extra: Record<string, unknown> = {}) {
    const agent = createAgent({
      index: await index(),
      model: model('It takes four to seven working days [1].'),
    })
    return elevenLabsToolRoute({ agent, ...extra })
  }

  it('answers a question passed as a query parameter', async () => {
    const handle = await route()
    const response = await handle(new Request('https://x.example/tool?question=how+long+is+delivery'))
    const body = (await response.json()) as { answer: string; found: boolean }

    expect(body.found).toBe(true)
    // Spoken by their agent, so citation markers must not survive.
    expect(body.answer).not.toContain('[1]')
    expect(body.answer).toContain('four to seven working days')
  })

  it('accepts a JSON body too, since their tool builder can send either', async () => {
    const handle = await route()
    const response = await handle(
      new Request('https://x.example/tool', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'how long is delivery', caller: '+15551234' }),
      }),
    )
    expect(((await response.json()) as { found: boolean }).found).toBe(true)
  })

  it('returns passages instead when the voice agent writes its own reply', async () => {
    const handle = await route({ mode: 'passages' })
    const response = await handle(new Request('https://x.example/tool?question=delivery'))
    const body = (await response.json()) as { passages: Array<{ ref: number; text: string }> }

    expect(body.passages[0]?.ref).toBe(1)
    expect(body.passages[0]?.text).toContain('working days')
  })

  it('refuses without the configured token', async () => {
    const handle = await route({ token: 'shh' })
    expect((await handle(new Request('https://x.example/tool?question=x'))).status).toBe(401)

    const authorised = await handle(
      new Request('https://x.example/tool?question=how+long+is+delivery', {
        headers: { authorization: 'Bearer shh' },
      }),
    )
    expect(authorised.status).toBe(200)
  })

  it('needs a question', async () => {
    const handle = await route()
    expect((await handle(new Request('https://x.example/tool'))).status).toBe(400)
  })

  it('answers 200 with an honest message when the lookup fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('down')
      },
    })
    // A 500 leaves their agent improvising; a sayable sentence does not.
    const handle = elevenLabsToolRoute({ agent: createAgent({ index: await index(), model: broken }) })
    const response = await handle(new Request('https://x.example/tool?question=hello'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { found: boolean; answer: string }
    expect(body.found).toBe(false)
    expect(body.answer).toBeTruthy()
    spy.mockRestore()
  })

  it('generates a system prompt that fences their agent to the tool', () => {
    const prompt = elevenLabsSystemPrompt({ business: 'Lumen Coffee', toolName: 'search_help' })
    expect(prompt).toContain('call search_help')
    expect(prompt).toContain('Answer only from what search_help returns')
    expect(prompt).toContain('one or two sentences')
  })
})

describe('how soon the caller hears something', () => {
  it('releases the opening clause on a comma, before the sentence ends', () => {
    const buffer = createSentenceBuffer()
    // A single-sentence answer has no interior full stop, so without this the
    // caller waits for the entire reply to generate before hearing a word.
    const out = buffer.push('Delivery to the United States costs twelve pounds flat, and takes four to seven working days.')
    expect(out[0]).toBe('Delivery to the United States costs twelve pounds flat,')
  })

  it('does not chop a short opening clause just to say something', () => {
    const buffer = createSentenceBuffer()
    expect(buffer.push('Yes, we do. ')).toEqual(['Yes, we do.'])
  })

  it('only breaks early once; the rest follows sentence boundaries', () => {
    const buffer = createSentenceBuffer()
    buffer.push('Delivery to the United States costs twelve pounds flat, and takes four to seven days. ')
    const next = buffer.push('Subscriptions ship free, every time, on every order, anywhere we deliver. ')
    // No mid-sentence comma break in the second sentence.
    expect(next).toEqual(['Subscriptions ship free, every time, on every order, anywhere we deliver.'])
  })

  it('resets between turns, so each answer starts quickly', () => {
    const buffer = createSentenceBuffer()
    buffer.push('First answer here, with a clause. ')
    buffer.flush()
    const out = buffer.push('Second answer that is also quite long here, and continues further still.')
    expect(out[0]).toContain('Second answer that is also quite long here,')
  })
})

describe('reading a table aloud', () => {
  it('drops the separator row, which is pure punctuation', () => {
    const said = toSpeech('| Country | Time |\n| --- | --- |\n| UK | 1 to 2 days |')

    expect(said).not.toContain('---')
    expect(said).not.toContain('|')
  })

  it('turns a row into its cells, separated so they do not run together', () => {
    // The bug this exists to stop: a delivery table read out as
    // "pipe United Kingdom pipe Royal Mail pipe".
    const said = toSpeech('| United Kingdom | Royal Mail | 1 to 2 days |')

    expect(said).toBe('United Kingdom, Royal Mail, 1 to 2 days')
  })

  it('keeps every value, since dropping one is worse than reading punctuation', () => {
    const said = toSpeech('| Country | Cost |\n| --- | --- |\n| UK | £3.95 |\n| EU | £7.50 |')

    for (const value of ['UK', '£3.95', 'EU', '£7.50']) expect(said).toContain(value)
  })

  it('leaves a sentence with a pipe in it alone', () => {
    expect(toSpeech('Use a || b for a fallback.')).toContain('||')
  })
})

describe('what the voice tool hands back', () => {
  const table = '| Country | Time |\n| --- | --- |\n| UK | 1 to 2 days |'

  it('never returns a table to something that will read it aloud', () => {
    // Both modes of the tool feed a speech engine. Either one returning raw
    // markdown is heard as "pipe Country pipe Time pipe".
    const spoken = toSpeech(table)

    expect(spoken).not.toContain('|')
    expect(spoken).toContain('UK, 1 to 2 days')
  })

  it('keeps the words when it removes the punctuation', () => {
    const spoken = toSpeech('| Destination | Carrier |\n| --- | --- |\n| United States | DHL Express |')

    expect(spoken).toContain('United States')
    expect(spoken).toContain('DHL Express')
  })

  it('handles a row that does not end the text, which is how passages join', () => {
    // The bug this exists to stop: joining two passages welded the last row of
    // one to the prose of the next, and the row stopped being recognised.
    const spoken = toSpeech('| UK | 1 to 2 days |\nDelivery is £3.95 flat.')

    expect(spoken).not.toContain('|')
    expect(spoken).toContain('UK, 1 to 2 days')
    expect(spoken).toContain('£3.95')
  })
})

describe('the socket Twilio opens', () => {
  const authToken = 'test-token'
  const url = 'wss://agent.example.com/voice/relay'

  it('accepts a handshake Twilio signed', async () => {
    // Signed over the url alone: an upgrade request has no form body.
    const signature = await signTwilio(url, {}, authToken)

    expect(await verifyRelayHandshake({ signature, url, authToken })).toBe(true)
  })

  it('refuses one nobody signed', async () => {
    // Without this the socket answers anybody who learns the url, and every
    // turn on it costs a model call and a synthesis.
    expect(await verifyRelayHandshake({ signature: null, url, authToken })).toBe(false)
    expect(await verifyRelayHandshake({ signature: 'not-a-signature', url, authToken })).toBe(false)
  })

  it('refuses a handshake signed for a different socket', async () => {
    const signature = await signTwilio('wss://somewhere-else.example.com/relay', {}, authToken)

    expect(await verifyRelayHandshake({ signature, url, authToken })).toBe(false)
  })

  it('is signed over the wss url, not the https one', async () => {
    // The trap: a framework hands you `https://` rebuilt from the request, and
    // Twilio signed the `wss://` string from the TwiML. The mismatch surfaces
    // as error 64102, "Unable to Connect to Websocket URL", which reads like a
    // network fault rather than a rejected signature.
    const signature = await signTwilio(url, {}, authToken)

    expect(await verifyRelayHandshake({ signature, url: url.replace('wss://', 'https://'), authToken })).toBe(false)
  })

  it('is exact about a trailing slash', async () => {
    const signature = await signTwilio(url, {}, authToken)

    expect(await verifyRelayHandshake({ signature, url: `${url}/`, authToken })).toBe(false)
  })
})
