/**
 * Getting the microphone into slices the server can work with.
 *
 * The browser gives audio to a worklet in blocks of 128 samples, which at a
 * typical rate is under three milliseconds. Sending each one is fifty times
 * more messages than anything needs, so the worklet gathers them into slices
 * of about twenty milliseconds first and posts those.
 *
 * The worklet itself is deliberately tiny. It runs on the audio thread, where
 * anything slow is heard rather than merely measured, and it cannot be reached
 * by the test suite, so all it does is count and copy. Everything with a
 * decision in it, the resampling and the conversion, happens on the main
 * thread where `pcm.ts` already covers it.
 */

import { TARGET_RATE, downsample, toPcm16 } from './pcm.js'

/**
 * Source for the audio-thread half, loaded as its own module.
 *
 * A string rather than a file because the widget ships as one script from a
 * CDN, and `addModule` needs a URL. A blob made here is that URL, and it keeps
 * the worklet in the same bundle as the code that uses it.
 */
export const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.wanted = options.processorOptions.frameSamples
    this.buffer = new Float32Array(this.wanted)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true

    let read = 0
    while (read < channel.length) {
      const room = this.wanted - this.filled
      const take = Math.min(room, channel.length - read)

      this.buffer.set(channel.subarray(read, read + take), this.filled)
      this.filled += take
      read += take

      if (this.filled === this.wanted) {
        // A copy, because the buffer is reused for the next slice and the
        // receiving side may still be holding this one.
        this.port.postMessage(this.buffer.slice(0))
        this.filled = 0
      }
    }

    return true
  }
}

registerProcessor('recourse-capture', Capture)
`

/**
 * What we ask the browser for.
 *
 * Echo cancellation is the one that matters. Without it the microphone picks
 * the agent up through the speakers, the turn detector hears speech, and the
 * agent answers its own sentence. It is the worst failure this feature has and
 * it costs one line.
 *
 * Exported so it is a value the suite can check rather than a detail buried in
 * a function nothing can see into.
 */
export const MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
}

export interface Microphone {
  /** Stops capture and releases the device, which turns the browser light off. */
  stop(): Promise<void>
}

/** What the browser will actually record in, decided at open time. */
export type Codec = 'opus' | 'pcm16'

/**
 * Container types worth asking for, best first.
 *
 * Opus in WebM is what Chrome and Firefox produce; Safari records into MP4.
 * Both are formats a transcription endpoint accepts directly, so nothing has
 * to be decoded on the way.
 */
const COMPRESSED_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']

/** The first recording type this browser will actually produce, if any. */
export function compressedType(): string | null {
  const recorder = (globalThis as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder
  if (!recorder?.isTypeSupported) return null

  return COMPRESSED_TYPES.find((type) => recorder.isTypeSupported?.(type)) ?? null
}

export interface MicrophoneOptions {
  /**
   * Handed each slice, already at the rate the server expects.
   *
   * Called for every slice whatever the codec, because the loudness of the
   * room is measured from these and the turn detector runs on that rather than
   * on the audio itself.
   */
  onFrame: (samples: Int16Array) => void
  /** Slice length in milliseconds, before resampling. */
  frameMs?: number
  /**
   * Asks for compressed audio as well, and reports what it got.
   *
   * Sixteen bit audio at 16kHz is 256 kbps up. The same speech as Opus is
   * around 24, which is the difference between a call that survives a weak
   * mobile connection and one that stutters through it. Transcription accuracy
   * is unchanged above about 20 kbps.
   *
   * `first` marks the chunk carrying the container's header. It has to be kept
   * and put in front of any later run of chunks, or what arrives is a
   * fragment nothing can open.
   */
  onCompressed?: (chunk: ArrayBuffer, first: boolean) => void
  /** How often compressed chunks arrive. Smaller is finer, and more overhead. */
  chunkMs?: number
  /** Injected by the tests, which have no audio hardware. */
  open?: () => Promise<{ context: AudioContext; stream: MediaStream }>
  /** Injected by the tests. Defaults to the browser's own recorder. */
  record?: (stream: MediaStream, type: string, chunkMs: number, onChunk: (chunk: Blob) => void) => { stop: () => void }
}

/**
 * Opens the microphone and starts posting slices.
 *
 * Echo cancellation, noise suppression and gain control are asked for rather
 * than assumed. Without the first of those the agent hears itself through the
 * speakers and answers its own sentences, which is the single worst failure
 * this feature has and costs one line to avoid.
 */
export async function createMicrophone(options: MicrophoneOptions): Promise<Microphone> {
  const frameMs = options.frameMs ?? 20
  const { context, stream } = await (options.open ?? openDefault)()

  const frameSamples = Math.round((context.sampleRate * frameMs) / 1000)
  const source = context.createMediaStreamSource(stream)

  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }))
  try {
    await context.audioWorklet.addModule(url)
  } finally {
    // The module is compiled by now, so the URL has done its job and would
    // otherwise be held for the life of the page.
    URL.revokeObjectURL(url)
  }

  const worklet = new AudioWorkletNode(context, 'recourse-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { frameSamples },
  })

  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const dropped = downsample(event.data, context.sampleRate, TARGET_RATE)
    options.onFrame(toPcm16(dropped))
  }

  source.connect(worklet)

  // The same stream, recorded compressed alongside the raw slices. Two readers
  // of one microphone rather than two microphones: asking twice would prompt
  // the visitor twice and give the echo canceller two things to cancel.
  let recorder: { stop: () => void } | null = null
  if (options.onCompressed) {
    const type = compressedType()
    if (type) {
      let first = true
      recorder = (options.record ?? recordDefault)(stream, type, options.chunkMs ?? 200, (chunk) => {
        const wasFirst = first
        first = false
        // A zero length chunk carries no cluster and no header. Sending it
        // would put an empty message on the wire for nothing.
        if (chunk.size === 0) return
        void chunk.arrayBuffer().then((buffer) => options.onCompressed?.(buffer, wasFirst))
      })
    }
  }

  return {
    async stop() {
      worklet.port.onmessage = null
      recorder?.stop()
      source.disconnect()
      worklet.disconnect()
      // Every track, or the browser keeps showing the page as recording.
      for (const track of stream.getTracks()) track.stop()
      await context.close()
    },
  }
}

/**
 * The browser's own recorder, wired to hand over each slice as it lands.
 *
 * `start(chunkMs)` is what makes chunks arrive during the recording rather
 * than all at the end, which is the whole point on a live call.
 */
function recordDefault(
  stream: MediaStream,
  type: string,
  chunkMs: number,
  onChunk: (chunk: Blob) => void,
): { stop: () => void } {
  const recorder = new MediaRecorder(stream, { mimeType: type })
  recorder.ondataavailable = (event) => onChunk(event.data)
  recorder.start(chunkMs)

  return {
    stop: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {
        // Already stopped, or the track went away first.
      }
    },
  }
}

async function openDefault(): Promise<{ context: AudioContext; stream: MediaStream }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: MICROPHONE_CONSTRAINTS })

  return { context: new AudioContext(), stream }
}
