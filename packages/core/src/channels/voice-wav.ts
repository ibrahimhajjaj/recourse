/**
 * A WAV wrapper around raw samples.
 *
 * The browser sends the microphone as bare 16-bit samples, because a header
 * per slice would be wasted bytes on every one of them. The transcriber wants
 * a file with a media type, and every provider accepts WAV while none of them
 * agree about raw audio. Forty-four bytes once per turn is a cheaper answer
 * than a format negotiation.
 */

/** What speech recognition asks for, and what the pipeline is built around. */
export const TARGET_RATE = 16_000

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
