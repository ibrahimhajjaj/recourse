import { describe, expect, it } from 'vitest'
import { TARGET_RATE, downsample, fromPcm16, toPcm16, toWav } from '../src/pcm.js'

/** A sine wave, which is the only honest way to test a resampler. */
function tone(hz: number, rate: number, ms: number): Float32Array {
  const samples = new Float32Array(Math.round((rate * ms) / 1000))
  for (let index = 0; index < samples.length; index++) {
    samples[index] = Math.sin((2 * Math.PI * hz * index) / rate)
  }

  return samples
}

describe('dropping the sample rate', () => {
  it('produces the right number of samples for the new rate', () => {
    const input = tone(440, 48_000, 100)

    expect(downsample(input, 48_000, 16_000)).toHaveLength(input.length / 3)
  })

  it('leaves the signal alone when the rates already match', () => {
    // Some hardware runs at 16kHz, and resampling it would only lose detail.
    const input = tone(440, 16_000, 50)

    expect(downsample(input, 16_000, 16_000)).toBe(input)
  })

  it('averages rather than picks, so sound above the new limit is damped', () => {
    // 16kHz can only carry up to 8kHz, so a 12kHz tone cannot survive the drop
    // honestly. Picking every third sample folds it back down at full volume,
    // heard as a metallic edge on sibilants and reaching the transcript as the
    // wrong words. Averaging damps it instead.
    const tooHigh = tone(12_000, 48_000, 100)

    const peak = (samples: Float32Array) => {
      let most = 0
      for (const sample of samples) most = Math.max(most, Math.abs(sample))

      return most
    }

    const picked = new Float32Array(Math.floor(tooHigh.length / 3))
    for (let index = 0; index < picked.length; index++) picked[index] = tooHigh[index * 3] as number

    expect(peak(downsample(tooHigh, 48_000, 16_000))).toBeLessThan(peak(picked) / 2)
  })

  it('keeps a tone the new rate can carry', () => {
    const speech = tone(300, 48_000, 100)
    const dropped = downsample(speech, 48_000, 16_000)

    let peak = 0
    for (const sample of dropped) peak = Math.max(peak, Math.abs(sample))

    expect(peak).toBeGreaterThan(0.8)
  })

  it('survives an empty buffer, which a stream can hand over', () => {
    expect(downsample(new Float32Array(0), 48_000)).toHaveLength(0)
  })
})

describe('converting to what goes on the wire', () => {
  it('maps the full range without wrapping', () => {
    const converted = toPcm16(Float32Array.from([0, 1, -1]))

    expect(converted[0]).toBe(0)
    expect(converted[1]).toBe(32767)
    expect(converted[2]).toBe(-32768)
  })

  it('clamps rather than wraps on a loud syllable', () => {
    // The bug this exists to stop: without the clamp the loudest moment of a
    // word wraps to the quietest and is heard as a click mid-speech.
    const converted = toPcm16(Float32Array.from([1.4, -1.4]))

    expect(converted[0]).toBe(32767)
    expect(converted[1]).toBe(-32768)
  })

  it('round-trips closely enough to be inaudible', () => {
    const original = tone(440, TARGET_RATE, 20)
    const back = fromPcm16(toPcm16(original))

    for (let index = 0; index < original.length; index++) {
      expect(Math.abs((back[index] as number) - (original[index] as number))).toBeLessThan(0.001)
    }
  })
})
