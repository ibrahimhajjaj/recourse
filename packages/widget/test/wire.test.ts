import { describe, expect, it } from 'vitest'
import { createHostedCall, type Socket } from '../src/hosted-call.js'
import { attachCall } from '../../core/src/channels/voice-socket.js'
import type { CallTranscript } from '../src/call.js'

/**
 * The two halves, talking to each other.
 *
 * Both ends of this protocol were written separately, each against an
 * assumption about the other. Their own suites check each side against that
 * assumption, which is exactly the shape of test that passes while the wire is
 * broken. This one joins them with a pipe and asserts a real turn survives the
 * round trip: hello, microphone up, transcript back, speech back.
 *
 * Server code in a browser package is deliberate. The alternative is trusting
 * two descriptions of one format to stay in agreement, which they do not.
 */

const settle = async (ms = 0) => {
  for (let tick = 0; tick < 30; tick++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Two sockets wired to each other, the way a real pair behaves.
 *
 * The client end is the shape the widget expects, with `on*` handlers. The
 * server end is the shape `attachCall` expects, with `addEventListener`. That
 * mismatch is itself part of what this is checking.
 */
function pipe() {
  const serverHandlers: Record<string, Array<(event: { data?: unknown }) => void>> = {}
  const toClient: Array<string | ArrayBuffer> = []

  const client: Socket = {
    readyState: 1,
    binaryType: '',
    send: (data) => {
      // Straight across, as a socket would: a view arrives as its own bytes.
      const copy = typeof data === 'string' ? data : sliceOf(data)
      for (const handler of serverHandlers.message ?? []) handler({ data: copy })
    },
    close: () => {
      for (const handler of serverHandlers.close ?? []) handler({})
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  }

  const server = {
    send: (data: string | ArrayBuffer) => {
      toClient.push(data)
      client.onmessage?.({ data })
    },
    addEventListener: (type: string, handler: (event: { data?: unknown }) => void) => {
      serverHandlers[type] ??= []
      serverHandlers[type].push(handler)
    },
    close: () => {},
  }

  return { client, server, toClient }
}

/** What a socket puts on the wire for a view: its own bytes, nothing else. */
function sliceOf(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0)

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

describe('the two halves of a hosted call, joined', () => {
  it('carries a whole turn across the wire both ways', async () => {
    const wire = pipe()
    const heard: Int16Array[] = []
    const said: CallTranscript[] = []

    attachCall(wire.server, {
      agent: {
        async *stream() {
          yield { type: 'delta', text: 'It shipped on Tuesday. ' }
        },
      },
      transcriber: {
        name: 't',
        transcribe: async (audio) => {
          // Past the WAV header the server wraps the clip in.
          const body = audio.byteOffset + 44
          heard.push(new Int16Array(audio.buffer.slice(body, audio.byteOffset + audio.byteLength)))

          return { text: 'where is my order' }
        },
      },
      voice: {
        name: 'v',
        speak: async () => ({ audio: new ArrayBuffer(480), contentType: 'audio/mpeg' }),
      },
    })

    let frame: ((samples: Int16Array) => void) | null = null
    const played: number[] = []

    const call = createHostedCall({
      endpoint: '/api/voice/call',
      conversationId: () => 'c_wire',
      onTranscript: (entry) => void said.push(entry),
      connect: () => wire.client,
      microphone: async (options) => {
        frame = options.onFrame

        return { stop: async () => {} }
      },
      audio: () => ({
        sampleRate: 16_000,
        now: () => 0,
        decode: async (clip) => new Float32Array(clip.byteLength / 2),
        play: (chunk) => void played.push(chunk.length),
        stop: () => {},
        close: async () => {},
      }),
    })

    await call.start()
    wire.client.onopen?.({})
    await settle()

    expect(call.state).toBe('live')

    // Speak, then go quiet long enough for the server to call the turn over.
    const loud = Int16Array.from({ length: 320 }, (_, at) => (at % 2 ? 8000 : -8000))
    for (let elapsed = 0; elapsed < 600; elapsed += 20) frame?.(loud)
    for (let elapsed = 0; elapsed < 900; elapsed += 20) frame?.(new Int16Array(320))
    await settle(5)

    // The exact samples, not merely something non-zero. An earlier version of
    // this checked only that the server heard sound, and passed while the
    // client was sending floats the server was reading as 16-bit noise.
    expect(heard.length).toBeGreaterThan(0)
    const clip = heard[0] as Int16Array
    expect(clip.length).toBeGreaterThan(loud.length)
    // The loud part is in there verbatim, at whatever offset the leading
    // silence puts it.
    const found = [...clip].findIndex((sample, at) => sample === 8000 && clip[at + 1] === -8000)
    expect(found).toBeGreaterThanOrEqual(0)
    expect([...clip.slice(found, found + 8)]).toEqual([8000, -8000, 8000, -8000, 8000, -8000, 8000, -8000])

    // And the answer came back down the same wire, as text and as speech.
    expect(said).toContainEqual({ role: 'visitor', text: 'where is my order' })
    expect(said.some((entry) => entry.role === 'agent')).toBe(true)
    expect(played.length).toBeGreaterThan(0)
  })

  it('agrees on what hello looks like', async () => {
    // The client writes it and the server reads it. A rename on either side
    // costs nothing at compile time and everything at run time.
    const wire = pipe()
    const seen: unknown[] = []

    attachCall(
      {
        send: wire.server.send,
        addEventListener: (type, handler) => {
          wire.server.addEventListener(type, (event) => {
            if (typeof event.data === 'string') seen.push(JSON.parse(event.data))
            handler(event)
          })
        },
        close: () => {},
      },
      {
        agent: {
          async *stream() {
            yield { type: 'delta', text: 'hi' }
          },
        },
        transcriber: { name: 't', transcribe: async () => ({ text: 'hi' }) },
        voice: { name: 'v', speak: async () => ({ audio: new ArrayBuffer(8), contentType: 'audio/mpeg' }) },
      },
    )

    const call = createHostedCall({
      endpoint: '/api/voice/call',
      conversationId: () => 'c_hello',
      connect: () => wire.client,
      microphone: async () => ({ stop: async () => {} }),
      audio: () => ({
        sampleRate: 16_000,
        now: () => 0,
        decode: async () => new Float32Array(0),
        play: () => {},
        stop: () => {},
        close: async () => {},
      }),
    })

    await call.start()
    wire.client.onopen?.({})
    await settle()

    expect(seen[0]).toMatchObject({ type: 'hello', conversationId: 'c_hello' })
  })
})

describe('sending the audio compressed', () => {
  /**
   * A browser that can record. Nothing in a test environment has
   * MediaRecorder, which is exactly why the fallback below matters.
   */
  function canRecord(type = 'audio/webm;codecs=opus') {
    const previous = (globalThis as Record<string, unknown>).MediaRecorder
    ;(globalThis as Record<string, unknown>).MediaRecorder = {
      isTypeSupported: (candidate: string) => candidate === type,
    }

    return () => void ((globalThis as Record<string, unknown>).MediaRecorder = previous)
  }

  /** A browser that can record, and a recorder this test drives by hand. */
  function recorder() {
    let emit!: (bytes: number[], size?: number) => void
    let stopped = 0

    const record = (
      _stream: MediaStream,
      _type: string,
      _chunkMs: number,
      onChunk: (chunk: Blob) => void,
    ) => {
      emit = (bytes) => onChunk(new Blob([new Uint8Array(bytes)]))

      return { stop: () => void stopped++ }
    }

    return { record, get emit() { return emit }, get stopped() { return stopped } }
  }

  it('puts a whole turn on the wire as one openable file', async () => {
    const restore = canRecord()
    const wire = pipe()
    const heard: Array<{ bytes: Uint8Array; mimeType: string | undefined }> = []
    const rec = recorder()

    attachCall(wire.server, {
      agent: {
        async *stream() {
          yield { type: 'delta', text: 'Four to seven days.' }
        },
      },
      transcriber: {
        name: 't',
        transcribe: async (audio, options) => {
          heard.push({ bytes: new Uint8Array(audio), mimeType: options?.mimeType })

          return { text: 'how long is delivery' }
        },
      },
      voice: { name: 'v', speak: async () => ({ audio: new ArrayBuffer(8), contentType: 'audio/mpeg' }) },
    })

    let frame: ((samples: Int16Array) => void) | null = null
    let compressed: ((chunk: ArrayBuffer, first: boolean) => void) | null = null

    const call = createHostedCall({
      endpoint: '/api/voice/call',
      conversationId: () => 'c_opus',
      connect: () => wire.client,
      microphone: async (options) => {
        frame = options.onFrame
        compressed = options.onCompressed ?? null
        // The real capture starts a recorder; this stands in for it.
        void rec.record({} as MediaStream, 'audio/webm;codecs=opus', 200, () => {})

        return { stop: async () => {} }
      },
      audio: () => ({
        sampleRate: 16_000,
        now: () => 0,
        decode: async () => new Float32Array(4),
        play: () => {},
        stop: () => {},
        close: async () => {},
      }),
    })

    await call.start()
    wire.client.onopen?.({})
    await settle()

    expect(call.state).toBe('live')
    // The browser said what it would send, so the far end knows not to read
    // the binary frames as samples.
    expect(compressed).not.toBeNull()

    // The header, then a turn's worth of speech, then silence to end it.
    compressed?.(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer, true)
    const loud = Int16Array.from({ length: 320 }, (_, at) => (at % 2 ? 9000 : -9000))
    for (let elapsed = 0; elapsed < 600; elapsed += 20) frame?.(loud)
    compressed?.(new Uint8Array([1, 2, 3, 4]).buffer, false)
    for (let elapsed = 0; elapsed < 900; elapsed += 20) frame?.(new Int16Array(320))
    await settle(5)

    expect(heard).toHaveLength(1)
    // The header is in front of the clusters, or what arrives is a fragment
    // nothing can open.
    expect([...(heard[0]?.bytes ?? [])]).toEqual([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])
    expect(heard[0]?.mimeType).toBe('audio/webm;codecs=opus')
    restore()
  })

  it('never puts raw samples on the wire when compressing', async () => {
    // The saving is the whole point. Sending both would be worse than sending
    // neither compressed.
    const restore = canRecord()
    const wire = pipe()
    const binary: unknown[] = []

    const client: Socket = {
      ...wire.client,
      send: (data) => {
        if (typeof data !== 'string') binary.push(data)
        wire.client.send(data)
      },
    }

    let frame: ((samples: Int16Array) => void) | null = null
    let compressed: ((chunk: ArrayBuffer, first: boolean) => void) | null = null

    const call = createHostedCall({
      endpoint: '/api/voice/call',
      conversationId: () => 'c_only',
      connect: () => client,
      microphone: async (options) => {
        frame = options.onFrame
        compressed = options.onCompressed ?? null

        return { stop: async () => {} }
      },
      audio: () => ({
        sampleRate: 16_000,
        now: () => 0,
        decode: async () => new Float32Array(4),
        play: () => {},
        stop: () => {},
        close: async () => {},
      }),
    })

    await call.start()
    client.onopen?.({})
    await settle()

    for (let i = 0; i < 10; i++) frame?.(new Int16Array(320))
    await settle()

    expect(binary).toHaveLength(0)
    compressed?.(new Uint8Array([9]).buffer, true)
    await settle()
    expect(binary).toHaveLength(1)
    restore()
  })

  it('falls back to raw samples when the browser cannot record', async () => {
    // No MediaRecorder at all, which is the state this very test file runs in.
    // The call must still work rather than going silent.
    const wire = pipe()
    let compressed: unknown = 'untouched'

    const call = createHostedCall({
      endpoint: '/api/voice/call',
      conversationId: () => 'c_fallback',
      connect: () => wire.client,
      microphone: async (options) => {
        compressed = options.onCompressed

        return { stop: async () => {} }
      },
      audio: () => ({
        sampleRate: 16_000,
        now: () => 0,
        decode: async () => new Float32Array(4),
        play: () => {},
        stop: () => {},
        close: async () => {},
      }),
    })

    await call.start()
    wire.client.onopen?.({})
    await settle()

    expect(call.state).toBe('live')
    expect(compressed).toBeUndefined()
  })

  it('sends raw samples when a deployment turns compression off', async () => {
    const restore = canRecord()
    const wire = pipe()
    let compressed: unknown = 'untouched'

    const call = createHostedCall({
      endpoint: '/api/voice/call',
      conversationId: () => 'c_off',
      compress: false,
      connect: () => wire.client,
      microphone: async (options) => {
        compressed = options.onCompressed

        return { stop: async () => {} }
      },
      audio: () => ({
        sampleRate: 16_000,
        now: () => 0,
        decode: async () => new Float32Array(4),
        play: () => {},
        stop: () => {},
        close: async () => {},
      }),
    })

    await call.start()
    wire.client.onopen?.({})
    await settle()

    expect(compressed).toBeUndefined()
    restore()
  })
})
