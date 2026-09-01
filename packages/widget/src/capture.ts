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

export interface MicrophoneOptions {
  /** Handed each slice, already at the rate the server expects. */
  onFrame: (samples: Int16Array) => void
  /** Slice length in milliseconds, before resampling. */
  frameMs?: number
  /** Injected by the tests, which have no audio hardware. */
  open?: () => Promise<{ context: AudioContext; stream: MediaStream }>
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

  return {
    async stop() {
      worklet.port.onmessage = null
      source.disconnect()
      worklet.disconnect()
      // Every track, or the browser keeps showing the page as recording.
      for (const track of stream.getTracks()) track.stop()
      await context.close()
    },
  }
}

async function openDefault(): Promise<{ context: AudioContext; stream: MediaStream }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: MICROPHONE_CONSTRAINTS })

  return { context: new AudioContext(), stream }
}
