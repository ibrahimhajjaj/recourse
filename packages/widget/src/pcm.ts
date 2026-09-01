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
 * Loudness of a slice, from 0 to 1.
 *
 * The same root mean square the server computes, and it has to stay the same:
 * when the audio goes up compressed, this number is what the turn detector
 * runs on instead, and a different scale here would move the point at which
 * somebody is judged to have stopped talking.
 */
export function levelOf(samples: Int16Array): number {
  if (samples.length === 0) return 0

  let sum = 0
  for (const sample of samples) sum += sample * sample

  return Math.min(1, Math.sqrt(sum / samples.length) / 32768)
}
