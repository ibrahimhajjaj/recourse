import { describe, expect, it } from 'vitest'
import { createHostedCall, type Socket } from '../src/hosted-call.js'
import type { CallState, CallTranscript } from '../src/call.js'

/**
 * `start` hands the microphone off without awaiting it, so anything checking
 * what happened after the device opened has to outlast it.
 */
const settle = async (ms = 0) => {
  for (let tick = 0; tick < 20; tick++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** A socket this test drives by hand. */
function fakeSocket() {
  const sent: Array<string | ArrayBuffer | ArrayBufferView> = []
  let closed = 0

  const socket: Socket = {
    readyState: 1,
    binaryType: '',
    send: (data) => void sent.push(data),
    close: () => void closed++,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  }

  return {
    socket,
    sent,
    get closed() {
      return closed
    },
    open: () => socket.onopen?.({}),
    say: (message: unknown) => socket.onmessage?.({ data: JSON.stringify(message) }),
    hear: (clip: ArrayBuffer) => socket.onmessage?.({ data: clip }),
    get control() {
      return sent.filter((item): item is string => typeof item === 'string').map((item) => JSON.parse(item) as Record<string, unknown>)
    },
    get audio() {
      return sent.filter((item) => typeof item !== 'string')
    },
  }
}

function harness(extra: { micFails?: boolean; slowMic?: boolean } = {}) {
  const wire = fakeSocket()
  const states: CallState[] = []
  const said: CallTranscript[] = []
  const errors: string[] = []
  const played: Array<{ at: number; length: number }> = []
  let micStopped = 0
  let speakersStopped = 0
  let frame: ((samples: Int16Array) => void) | null = null
  let clock = 100

  const call = createHostedCall({
    endpoint: '/api/voice/call',
    conversationId: () => 'c_1',
    onStateChange: (state) => void states.push(state),
    onTranscript: (entry) => void said.push(entry),
    onError: (message) => void errors.push(message),
    connect: () => wire.socket,
    microphone: async (options) => {
      if (extra.slowMic) await new Promise((resolve) => setTimeout(resolve, 5))
      if (extra.micFails) throw new Error('blocked')
      frame = options.onFrame

      return { stop: async () => void micStopped++ }
    },
    audio: () => ({
      sampleRate: 24_000,
      now: () => clock,
      decode: async (clip) => new Float32Array(clip.byteLength),
      play: (chunk, at) => void played.push({ at, length: chunk.length }),
      stop: () => void speakersStopped++,
      close: async () => {},
    }),
  })

  return {
    call,
    wire,
    states,
    said,
    errors,
    played,
    get micStopped() {
      return micStopped
    },
    get speakersStopped() {
      return speakersStopped
    },
    sendFrame: (samples = new Int16Array(320)) => frame?.(samples),
    tick: (to: number) => void (clock = to),
  }
}

describe('placing a call the server carries', () => {
  it('introduces itself with the conversation the chat is using', async () => {
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    expect(call.wire.control[0]).toMatchObject({ type: 'hello', conversationId: 'c_1' })
  })

  it('goes live once the microphone is running, not merely when connected', async () => {
    // Reporting live before the device is open promises audio that is not
    // flowing, and the caller talks into nothing.
    const call = harness()
    await call.call.start()
    expect(call.call.state).toBe('connecting')

    call.wire.open()
    await settle()

    expect(call.call.state).toBe('live')
    expect(call.states).toEqual(['connecting', 'live'])
  })

  it('streams microphone slices as binary', async () => {
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    call.sendFrame()
    call.sendFrame()

    expect(call.wire.audio).toHaveLength(2)
  })

  it('sends only its own slice, not the buffer behind it', async () => {
    // Sending `.buffer` is right only while the conversion allocates fresh.
    // A slice of a larger pool would put the whole pool on the wire, and the
    // far end would hear audio that was never part of this frame.
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    const pool = new Int16Array(1000)
    call.sendFrame(pool.subarray(100, 420))

    const sent = call.wire.audio[0] as ArrayBufferView
    expect(sent.byteLength).toBe(320 * 2)
  })

  it('puts what was said into the thread', async () => {
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    call.wire.say({ type: 'transcript', role: 'visitor', text: 'where is my order' })
    call.wire.say({ type: 'transcript', role: 'agent', text: 'It shipped Tuesday.' })

    expect(call.said).toEqual([
      { role: 'visitor', text: 'where is my order' },
      { role: 'agent', text: 'It shipped Tuesday.' },
    ])
  })

  it('queues speech back to back rather than on top of itself', async () => {
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    call.wire.hear(new ArrayBuffer(2400))
    await settle()
    call.wire.hear(new ArrayBuffer(2400))
    await settle()

    expect(call.played).toHaveLength(2)
    expect(call.played[1]?.at).toBeGreaterThan(call.played[0]?.at as number)
  })

  it('ignores a clip that will not decode rather than ending the call', async () => {
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    call.wire.hear(new ArrayBuffer(0))
    await settle()

    expect(call.call.state).toBe('live')
  })
})

describe('being interrupted', () => {
  it('drops queued speech so the next answer is not stuck behind it', async () => {
    // The server has abandoned the answer. Without this the caller sits
    // through the silence of speech that was cancelled.
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    call.wire.hear(new ArrayBuffer(48_000))
    await settle()
    const before = call.played.length

    call.wire.say({ type: 'interrupted' })
    call.tick(101)
    call.wire.hear(new ArrayBuffer(2400))
    await settle()

    expect(call.speakersStopped).toBe(1)
    // The new clip starts from now, not after the abandoned one.
    expect(call.played[before]?.at).toBeLessThan(102)
  })
})

describe('hanging up', () => {
  it('releases the microphone and closes the socket', async () => {
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    await call.call.stop()

    expect(call.micStopped).toBe(1)
    expect(call.wire.closed).toBeGreaterThan(0)
    expect(call.call.state).toBe('ended')
  })

  it('stops sending audio the moment it is hung up', async () => {
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    await call.call.stop()
    call.sendFrame()

    expect(call.wire.audio).toHaveLength(0)
  })

  it('closes a microphone that opened after the caller gave up', async () => {
    // The bug this exists to stop: hanging up mid-connect and leaving a live
    // device with the browser's recording light on.
    const call = harness({ slowMic: true })
    const dialing = call.call.start()
    call.wire.open()
    await call.call.stop()
    await dialing
    await settle(20)

    expect(call.micStopped).toBe(1)
    expect(call.call.state).toBe('ended')
  })

  it('is safe before anything connected', async () => {
    const call = harness()

    await expect(call.call.stop()).resolves.toBeUndefined()
  })
})

describe('when it does not work', () => {
  it('says the microphone may be blocked, which is the usual cause', async () => {
    const call = harness({ micFails: true })
    await call.call.start()
    call.wire.open()
    await settle()

    expect(call.call.state).toBe('failed')
    expect(call.errors[0]).toMatch(/microphone/i)
  })

  it('does not leave the socket open when the microphone fails', async () => {
    const call = harness({ micFails: true })
    await call.call.start()
    call.wire.open()
    await settle()

    expect(call.wire.closed).toBeGreaterThan(0)
  })

  it('reports a socket error rather than sitting on connecting forever', async () => {
    const call = harness()
    await call.call.start()
    call.wire.socket.onerror?.({})
    await settle()

    expect(call.call.state).toBe('failed')
    expect(call.errors[0]).toBeTruthy()
  })

  it('ends when the server hangs up', async () => {
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    call.wire.socket.onclose?.({})
    await settle()

    expect(call.call.state).toBe('ended')
    expect(call.micStopped).toBe(1)
  })

  it('ignores a control frame it cannot read', async () => {
    const call = harness()
    await call.call.start()
    call.wire.open()
    await settle()

    call.wire.socket.onmessage?.({ data: 'not json' })

    expect(call.call.state).toBe('live')
  })
})
