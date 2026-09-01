import { describe, expect, it } from 'vitest'
import { attachCall, type CallSocket } from '../src/channels/voice-socket.js'
import type { Transcriber } from '../src/channels/voice-stt.js'
import type { Voice } from '../src/channels/voice-tts.js'

const RATE = 16_000
const SLICE = RATE / 50

const loud = () => Int16Array.from({ length: SLICE }, (_, at) => (at % 2 ? 8000 : -8000))
const quiet = () => new Int16Array(SLICE)

const settle = async () => {
  for (let tick = 0; tick < 40; tick++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** A socket this test drives by hand, in the shape every runtime provides. */
function fakeSocket() {
  const handlers: Record<string, Array<(event: { data?: unknown }) => void>> = {}
  const sent: Array<string | ArrayBuffer> = []
  let closed = false

  const socket: CallSocket = {
    send: (data) => void sent.push(data),
    addEventListener: (type, handler) => {
      handlers[type] ??= []
      handlers[type].push(handler)
    },
    close: () => void (closed = true),
  }

  return {
    socket,
    sent,
    get closed() {
      return closed
    },
    emit: (type: string, data?: unknown) => {
      for (const handler of handlers[type] ?? []) handler({ data })
    },
    /** Control messages the server sent, parsed. */
    get messages() {
      return sent.filter((item): item is string => typeof item === 'string').map((item) => JSON.parse(item) as { type: string })
    },
    get audio() {
      return sent.filter((item) => typeof item !== 'string')
    },
  }
}

function attach(socket: CallSocket, heard = 'where is my order') {
  const transcriber: Transcriber = { name: 't', transcribe: async () => ({ text: heard }) }
  const voice: Voice = {
    name: 'v',
    speak: async () => ({ audio: new ArrayBuffer(16), contentType: 'audio/mpeg' }),
  }

  return attachCall(socket, {
    agent: {
      async *stream() {
        yield { type: 'delta', text: 'It shipped on Tuesday. ' }
      },
    },
    transcriber,
    voice,
  })
}

/** Speaks, then goes quiet long enough to end the turn. */
function speak(wire: ReturnType<typeof fakeSocket>) {
  for (let elapsed = 0; elapsed < 600; elapsed += 20) wire.emit('message', loud())
  for (let elapsed = 0; elapsed < 900; elapsed += 20) wire.emit('message', quiet())
}

describe('carrying a call over a socket', () => {
  it('runs a whole turn and sends the audio back as its own frame', async () => {
    const wire = fakeSocket()
    attach(wire.socket)

    wire.emit('message', JSON.stringify({ type: 'hello', sampleRate: RATE }))
    speak(wire)
    await settle()

    expect(wire.messages.map((message) => message.type)).toContain('speaking')
    expect(wire.audio.length).toBeGreaterThan(0)
  })

  it('takes the microphone rate from the browser, since machines differ', async () => {
    const wire = fakeSocket()
    attach(wire.socket)

    // At 48kHz a 320-sample slice is a third of the time it is at 16kHz, so a
    // session that ignored this would end turns three times too early.
    wire.emit('message', JSON.stringify({ type: 'hello', sampleRate: 48_000 }))
    for (let slice = 0; slice < 30; slice++) wire.emit('message', loud())
    for (let slice = 0; slice < 20; slice++) wire.emit('message', quiet())
    await settle()

    expect(wire.messages.some((message) => message.type === 'thinking')).toBe(false)
  })

  it('does not hang up on a client that never introduced itself', async () => {
    // Being strict here costs a call and gains nothing.
    const wire = fakeSocket()
    attach(wire.socket)

    speak(wire)
    await settle()

    expect(wire.messages.some((message) => message.type === 'speaking')).toBe(true)
  })

  it('ignores a frame it cannot read rather than dropping the call', async () => {
    const wire = fakeSocket()
    attach(wire.socket)

    wire.emit('message', 'not json at all')
    wire.emit('message', JSON.stringify({ type: 'hello', sampleRate: RATE }))
    speak(wire)
    await settle()

    expect(wire.messages.some((message) => message.type === 'speaking')).toBe(true)
  })

  it('reads only its own slice of a shared buffer', async () => {
    // Node hands over a Buffer pointing into a pool it shares with other
    // reads. The pool here is loud everywhere except this call's slice, which
    // is silent, so ignoring the offset hears speech that is not there.
    const wire = fakeSocket()
    attach(wire.socket)
    wire.emit('message', JSON.stringify({ type: 'hello', sampleRate: RATE }))

    const pool = new Int16Array(SLICE * 4).fill(9000)
    const mine = new Int16Array(pool.buffer, SLICE * 2, SLICE)
    mine.fill(0)

    for (let elapsed = 0; elapsed < 1500; elapsed += 20) wire.emit('message', mine)
    await settle()

    // Silence, so nothing should have been heard at all.
    expect(wire.messages).toEqual([])
  })

})

describe('when the far end goes away', () => {
  it('stops the session and tells the host', async () => {
    const wire = fakeSocket()
    let told = false

    attachCall(wire.socket, {
      agent: {
        async *stream() {
          yield { type: 'delta', text: 'hello' }
        },
      },
      transcriber: { name: 't', transcribe: async () => ({ text: 'hi' }) },
      voice: { name: 'v', speak: async () => ({ audio: new ArrayBuffer(8), contentType: 'audio/mpeg' }) },
      onClose: () => void (told = true),
    })

    wire.emit('message', JSON.stringify({ type: 'hello', sampleRate: RATE }))
    wire.emit('close')

    expect(told).toBe(true)

    // Anything still arriving is ignored rather than answered into a dead socket.
    speak(wire)
    await settle()
    expect(wire.audio).toHaveLength(0)
  })

  it('treats an error the same as a close', () => {
    const wire = fakeSocket()
    let told = 0

    attachCall(wire.socket, {
      agent: {
        async *stream() {
          yield { type: 'delta', text: 'hello' }
        },
      },
      transcriber: { name: 't', transcribe: async () => ({ text: 'hi' }) },
      voice: { name: 'v', speak: async () => ({ audio: new ArrayBuffer(8), contentType: 'audio/mpeg' }) },
      onClose: () => void told++,
    })

    wire.emit('error')
    wire.emit('close')

    // Once, not twice, however many ways the socket reports it is finished.
    expect(told).toBe(1)
  })

  it('closes the socket when the host hangs up', () => {
    const wire = fakeSocket()
    const call = attach(wire.socket)

    call.close()

    expect(wire.closed).toBe(true)
  })
})
