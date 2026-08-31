import { describe, expect, it } from 'vitest'
import { createCall, type CallState, type CallTranscript, type VoiceRuntime } from '../src/call.js'

const SIGNED = 'wss://voice.example/session?sig=abc'

/** A server that hands out a signed URL, and remembers what it was asked. */
function server(body: unknown = { signedUrl: SIGNED }, status = 200) {
  const bodies: Array<Record<string, unknown>> = []

  const fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof globalThis.fetch

  return { fetch, bodies }
}

/** A voice runtime whose connection this test drives by hand. */
function runtime() {
  const handlers: {
    connect?: () => void
    disconnect?: () => void
    error?: (error: unknown) => void
    message?: (message: { source?: string; message?: string }) => void
  } = {}
  let ended = 0
  const urls: string[] = []

  const voice: VoiceRuntime = {
    async startSession(options) {
      urls.push(options.signedUrl)
      handlers.connect = options.onConnect
      handlers.disconnect = options.onDisconnect
      handlers.error = options.onError
      handlers.message = options.onMessage

      return {
        endSession() {
          ended++
        },
      }
    },
  }

  return { voice, handlers, urls, get ended() { return ended } }
}

const track = () => {
  const states: CallState[] = []
  const errors: string[] = []
  const said: CallTranscript[] = []

  return {
    states,
    errors,
    said,
    onStateChange: (state: CallState) => void states.push(state),
    onError: (message: string) => void errors.push(message),
    onTranscript: (entry: CallTranscript) => void said.push(entry),
  }
}

describe('placing a call', () => {
  it('gets a signed URL, loads the runtime, and goes live on connect', async () => {
    const api = server()
    const voice = runtime()
    const seen = track()

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: api.fetch,
      load: async () => voice.voice,
      ...seen,
    })

    await call.start()
    expect(call.state).toBe('connecting')

    voice.handlers.connect?.()

    expect(call.state).toBe('live')
    expect(seen.states).toEqual(['connecting', 'live'])
    expect(voice.urls).toEqual([SIGNED])
  })

  it('ties the call to the conversation the chat is already using', async () => {
    // Read at dial time, not held: a call after a clear-and-restart has to
    // join the new conversation, not the one that was there at construction.
    const api = server()
    let current = 'c_first'

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => current,
      fetch: api.fetch,
      load: async () => runtime().voice,
    })

    await call.start()
    await call.stop()
    current = 'c_second'
    await call.start()

    expect(api.bodies.map((body) => body.conversationId)).toEqual(['c_first', 'c_second'])
  })

  it('does not dial twice when somebody double-clicks', async () => {
    const api = server()
    const voice = runtime()

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: api.fetch,
      load: async () => voice.voice,
    })

    await Promise.all([call.start(), call.start()])

    expect(api.bodies).toHaveLength(1)
  })

  it('reports what each side said as it arrives', async () => {
    const voice = runtime()
    const seen = track()

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: server().fetch,
      load: async () => voice.voice,
      ...seen,
    })

    await call.start()
    voice.handlers.message?.({ source: 'user', message: 'where is my order' })
    voice.handlers.message?.({ source: 'ai', message: 'It shipped on Tuesday.' })
    voice.handlers.message?.({ source: 'ai', message: '   ' })

    expect(seen.said).toEqual([
      { role: 'visitor', text: 'where is my order' },
      { role: 'agent', text: 'It shipped on Tuesday.' },
    ])
  })
})

describe('hanging up', () => {
  it('closes the session and reports it ended', async () => {
    const voice = runtime()
    const seen = track()

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: server().fetch,
      load: async () => voice.voice,
      ...seen,
    })

    await call.start()
    voice.handlers.connect?.()
    await call.stop()

    expect(voice.ended).toBe(1)
    expect(call.state).toBe('ended')
  })

  it('is safe before anything ever connected', async () => {
    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: server().fetch,
      load: async () => runtime().voice,
    })

    await expect(call.stop()).resolves.toBeUndefined()
  })

  it('never opens a session when the visitor gives up while it is loading', async () => {
    const voice = runtime()
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: server().fetch,
      load: async () => {
        await held
        return voice.voice
      },
    })

    const dialing = call.start()
    await call.stop()
    release?.()
    await dialing

    // Better than opening and closing: the microphone is never touched.
    expect(voice.urls).toHaveLength(0)
    expect(call.state).toBe('ended')
  })

  it('closes a session that opens after the visitor gave up', async () => {
    // The bug this exists to stop: hanging up while the connection is being
    // established, then it succeeding anyway and leaving a live microphone
    // nobody asked for.
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered: (() => void) | undefined
    // Hanging up any earlier returns at a guard before this point, so the test
    // has to wait until the connection is genuinely being established.
    const inside = new Promise<void>((resolve) => {
      entered = resolve
    })
    let ended = 0

    const slow: VoiceRuntime = {
      async startSession() {
        entered?.()
        await held
        return {
          endSession() {
            ended++
          },
        }
      },
    }

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: server().fetch,
      load: async () => slow,
    })

    const dialing = call.start()
    await inside
    await call.stop()
    release?.()
    await dialing

    expect(ended).toBe(1)
    expect(call.state).toBe('ended')
  })

  it('ignores a connect that lands after the visitor gave up', async () => {
    const voice = runtime()
    const seen = track()

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: server().fetch,
      load: async () => voice.voice,
      ...seen,
    })

    await call.start()
    await call.stop()
    voice.handlers.connect?.()

    expect(call.state).toBe('ended')
    expect(seen.states).not.toContain('live')
  })
})

describe('when it does not work', () => {
  const failing = (api: ReturnType<typeof server>, seen: ReturnType<typeof track>) =>
    createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: api.fetch,
      load: async () => runtime().voice,
      ...seen,
    })

  it('says so plainly when the account is being rate limited', async () => {
    const seen = track()
    await failing(server({ error: 'slow down' }, 429), seen).start()

    expect(seen.states).toEqual(['connecting', 'failed'])
    expect(seen.errors[0]).toMatch(/try again/i)
  })

  it('does not promise a call the server refused', async () => {
    const seen = track()
    await failing(server({ error: 'nope' }, 502), seen).start()

    expect(seen.errors[0]).toMatch(/not available/i)
  })

  it('treats a reply with no URL as a failure rather than dialling nothing', async () => {
    const seen = track()
    await failing(server({ ok: true }), seen).start()

    expect(seen.states).toContain('failed')
  })

  it('survives the runtime failing to load, which is a network away', async () => {
    const seen = track()
    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: server().fetch,
      load: async () => {
        throw new Error('offline')
      },
      ...seen,
    })

    await call.start()

    expect(call.state).toBe('failed')
    expect(seen.errors[0]).toMatch(/load/i)
  })

  it('blames the microphone when the runtime errors, since that is the usual cause', async () => {
    const voice = runtime()
    const seen = track()

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: server().fetch,
      load: async () => voice.voice,
      ...seen,
    })

    await call.start()
    voice.handlers.error?.(new Error('permission denied'))

    expect(seen.errors[0]).toMatch(/microphone/i)
  })

  it('can be tried again after a failure', async () => {
    const voice = runtime()
    let attempt = 0

    const call = createCall({
      endpoint: '/api/voice/token',
      conversationId: () => 'c_1',
      fetch: (async () => {
        attempt++
        return attempt === 1
          ? new Response('{}', { status: 502 })
          : new Response(JSON.stringify({ signedUrl: SIGNED }), { status: 200 })
      }) as unknown as typeof globalThis.fetch,
      load: async () => voice.voice,
    })

    await call.start()
    expect(call.state).toBe('failed')

    await call.start()
    voice.handlers.connect?.()

    expect(call.state).toBe('live')
  })
})
