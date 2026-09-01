import { describe, expect, it } from 'vitest'
import { TARGET_RATE, toWav } from '../src/channels/voice-wav.js'

/** A sine wave, so the samples are something other than zeroes. */
function tone(hz: number, rate: number, ms: number): Int16Array {
  const samples = new Int16Array(Math.round((rate * ms) / 1000))
  for (let index = 0; index < samples.length; index++) {
    samples[index] = Math.round(Math.sin((2 * Math.PI * hz * index) / rate) * 32767)
  }

  return samples
}

describe('wrapping a clip so a transcriber will take it', () => {
  const header = (wav: Uint8Array, at: number, length: number) =>
    String.fromCharCode(...wav.slice(at, at + length))

  it('writes a header every provider recognises', () => {
    const wav = toWav(tone(440, TARGET_RATE, 100))

    expect(header(wav, 0, 4)).toBe('RIFF')
    expect(header(wav, 8, 4)).toBe('WAVE')
    expect(header(wav, 36, 4)).toBe('data')
  })

  it('declares mono at the rate speech recognition expects', () => {
    const view = new DataView(toWav(tone(440, TARGET_RATE, 50)).buffer)

    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(TARGET_RATE)
    expect(view.getUint16(34, true)).toBe(16)
  })

  it('states a length that matches the bytes it actually wrote', () => {
    // A wrong length is the header field that makes a provider read silence
    // past the end of the clip, or refuse it outright.
    const samples = tone(440, TARGET_RATE, 100)
    const wav = toWav(samples)
    const view = new DataView(wav.buffer)

    expect(wav).toHaveLength(44 + samples.length * 2)
    expect(view.getUint32(40, true)).toBe(samples.length * 2)
    expect(view.getUint32(4, true)).toBe(wav.length - 8)
  })

  it('carries the samples through unchanged', () => {
    const samples = Int16Array.from([0, 1000, -1000, 32767])
    const view = new DataView(toWav(samples).buffer)

    for (let index = 0; index < samples.length; index++) {
      expect(view.getInt16(44 + index * 2, true)).toBe(samples[index])
    }
  })
})
