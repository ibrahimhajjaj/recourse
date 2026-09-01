import { describe, expect, it, vi } from 'vitest'
import { CAPTURE_WORKLET, MICROPHONE_CONSTRAINTS, createMicrophone } from '../src/capture.js'

/**
 * Runs the worklet source for real.
 *
 * It normally executes on the audio thread against globals only the browser
 * provides, which is the usual excuse for leaving this kind of code untested.
 * Supplying those two globals is enough to exercise the actual shipped string
 * rather than a copy of it that can drift.
 */
function loadWorklet(frameSamples: number) {
  const posted: Float32Array[] = []
  let Processor: (new (options: { processorOptions: { frameSamples: number } }) => {
    process(inputs: Float32Array[][]): boolean
    port: { postMessage: (data: Float32Array) => void }
  }) | null = null

  class FakeProcessor {
    port = { postMessage: (data: Float32Array) => void posted.push(data) }
  }

  const run = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    `${CAPTURE_WORKLET}\nreturn Capture`,
  ) as (base: unknown, register: (name: string, processor: unknown) => void) => typeof Processor

  const registered: string[] = []
  Processor = run(FakeProcessor, (name) => void registered.push(name))

  const instance = new (Processor as NonNullable<typeof Processor>)({ processorOptions: { frameSamples } })

  return { instance, posted, registered }
}

/** A block of the size the browser actually hands a worklet. */
const block = (value = 0.5, length = 128) => new Float32Array(length).fill(value)

describe('the audio-thread half', () => {
  it('registers under the name the node asks for', () => {
    // A mismatch here fails at construction with a name nobody recognises.
    const { registered } = loadWorklet(320)

    expect(registered).toEqual(['recourse-capture'])
  })

  it('gathers small blocks into one slice rather than posting each', () => {
    // 128 samples is under three milliseconds. Posting each is fifty times the
    // messages anything needs.
    const { instance, posted } = loadWorklet(320)

    for (let count = 0; count < 2; count++) instance.process([[block()]])
    expect(posted).toHaveLength(0)

    instance.process([[block()]])
    expect(posted).toHaveLength(1)
    expect(posted[0]).toHaveLength(320)
  })

  it('carries every sample through, in order and without gaps', () => {
    // Off-by-one here is heard as a click on every slice boundary, fifty times
    // a second, which sounds like a broken microphone rather than a bug.
    const { instance, posted } = loadWorklet(256)
    let next = 0

    for (let count = 0; count < 4; count++) {
      const ramp = new Float32Array(128)
      for (let at = 0; at < ramp.length; at++) ramp[at] = next++
      instance.process([[ramp]])
    }

    const all = [...(posted[0] as Float32Array), ...(posted[1] as Float32Array)]
    expect(all).toHaveLength(512)
    expect(all).toEqual(Array.from({ length: 512 }, (_, at) => at))
  })

  it('splits a block that straddles the end of a slice', () => {
    // The frame size is rarely a multiple of 128, so most slices end mid-block
    // and the remainder has to open the next one.
    const { instance, posted } = loadWorklet(100)

    instance.process([[block(0.5, 128)]])

    expect(posted).toHaveLength(1)
    // 28 samples carried over, so 72 more complete the second slice.
    instance.process([[block(0.5, 72)]])
    expect(posted).toHaveLength(2)
  })

  it('posts a copy, since the buffer is reused straight away', () => {
    // Without the copy every slice is the same array, and by the time the main
    // thread reads one it holds whatever was captured after it.
    const { instance, posted } = loadWorklet(128)

    instance.process([[block(0.25)]])
    instance.process([[block(0.75)]])

    expect(posted[0]?.[0]).toBeCloseTo(0.25, 5)
    expect(posted[1]?.[0]).toBeCloseTo(0.75, 5)
  })

  it('keeps running when there is no input yet', () => {
    // A disconnected or still-starting source gives an empty input, and
    // returning false there would end capture permanently.
    const { instance, posted } = loadWorklet(128)

    expect(instance.process([[]])).toBe(true)
    expect(instance.process([])).toBe(true)
    expect(posted).toHaveLength(0)
  })
})

describe('opening the microphone', () => {
  /** Enough of the audio API to see what the module asks for. */
  function fakeAudio(sampleRate = 48_000) {
    const stopped: string[] = []
    const added: string[] = []
    let onmessage: ((event: { data: Float32Array }) => void) | null = null

    const context = {
      sampleRate,
      audioWorklet: { addModule: async (url: string) => void added.push(url) },
      createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
      close: async () => void stopped.push('context'),
    }

    const stream = { getTracks: () => [{ stop: () => void stopped.push('track') }] }

    return {
      stopped,
      added,
      open: async () => ({ context, stream }) as never,
      get onmessage() {
        return onmessage
      },
      set onmessage(handler: ((event: { data: Float32Array }) => void) | null) {
        onmessage = handler
      },
    }
  }

  it('releases the device and the context when the call ends', async () => {
    // Leaving either open keeps the browser's recording indicator lit, which
    // people reasonably read as the page still listening to them.
    const audio = fakeAudio()
    const nodes: Array<{ port: { onmessage: unknown }; disconnect: () => void }> = []

    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('Blob', class {})
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port: { onmessage: unknown } = { onmessage: null }
        constructor() {
          nodes.push(this as never)
        }
        disconnect() {}
      },
    )

    const mic = await createMicrophone({ onFrame: () => {}, open: audio.open })
    await mic.stop()

    expect(audio.stopped).toContain('track')
    expect(audio.stopped).toContain('context')
  })

  it('asks for echo cancellation, or the agent answers itself', () => {
    // The single worst failure this feature has: without it the microphone
    // picks the agent up through the speakers and it replies to its own words.
    expect(MICROPHONE_CONSTRAINTS.echoCancellation).toBe(true)
    expect(MICROPHONE_CONSTRAINTS.noiseSuppression).toBe(true)
    // Mono, because speech recognition wants one channel and two is twice the
    // bytes on the wire for no gain.
    expect(MICROPHONE_CONSTRAINTS.channelCount).toBe(1)
  })
})
