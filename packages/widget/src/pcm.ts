/**
 * Turning what the microphone gives us into what a transcriber wants.
 *
 * The browser hands over 32-bit floats at whatever rate the sound card runs,
 * usually 48kHz. Speech recognition wants 16-bit integers at 16kHz. Nothing
 * about that conversion is interesting, and all of it is easy to get subtly
 * wrong in ways that sound like a bad line rather than like a bug: the wrong
 * rate is a chipmunk, a missing clamp is a crackle on loud syllables.
 *
 * So it lives here as arithmetic over arrays, away from anything that needs a
 * sound card, and the audio plumbing calls it.
 */

/** What speech recognition asks for, and what the pipeline is built around. */
export const TARGET_RATE = 16_000

/**
 * Drop a signal to a lower sample rate.
 *
 * Averages the samples that fall inside each output step rather than picking
 * one of them. Picking is cheaper and aliases: discarding two samples in three
 * folds the high frequencies back down as a metallic edge on sibilants, which
 * survives into the transcript as mistaken words.
 *
 * Returns the input untouched when the rates already match, which is the case
 * on hardware that happens to run at 16kHz.
 */
export function downsample(input: Float32Array, from: number, to: number = TARGET_RATE): Float32Array {
  if (to >= from || input.length === 0) return input

  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))

  for (let index = 0; index < out.length; index++) {
    const start = Math.floor(index * ratio)
    const end = Math.min(input.length, Math.floor((index + 1) * ratio))

    let sum = 0
    for (let at = start; at < end; at++) sum += input[at] as number
    out[index] = end > start ? sum / (end - start) : 0
  }

  return out
}

/**
 * Float samples to signed 16-bit, which is what goes on the wire.
 *
 * The clamp is the part that matters. A float track can exceed 1.0 on a loud
 * syllable, and without clamping the conversion wraps: the loudest moment of a
 * word becomes the quietest, heard as a click in the middle of speech.
 */
export function toPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)

  for (let index = 0; index < input.length; index++) {
    const sample = Math.max(-1, Math.min(1, input[index] as number))
    // Asymmetric on purpose: signed 16-bit runs to -32768 but only +32767.
    out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }

  return out
}

/** Back the other way, for audio arriving to be played. */
export function fromPcm16(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length)
  for (let index = 0; index < input.length; index++) out[index] = (input[index] as number) / 0x8000

  return out
}

/**
 * A WAV wrapper around raw samples.
 *
 * The transcriber takes a clip with a media type, and every provider accepts
 * WAV while none of them agree about raw PCM. Forty-four bytes of header is a
 * cheaper answer than a format negotiation.
 */
export function toWav(samples: Int16Array, rate: number = TARGET_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)

  const ascii = (at: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(at + index, text.charCodeAt(index))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // uncompressed
  view.setUint16(22, 1, true) // mono, which is what speech recognition wants
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per frame
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let index = 0; index < samples.length; index++) {
    view.setInt16(44 + index * 2, samples[index] as number, true)
  }

  return bytes
}
