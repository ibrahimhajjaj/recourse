import { describe, expect, it } from 'vitest'
import { createPlayback } from '../src/playback.js'

const RATE = 24_000
/** A chunk of a known length, so the arithmetic is checkable by hand. */
const chunk = (seconds: number) => new Float32Array(Math.round(RATE * seconds))

function harness(startAt = 0) {
  const scheduled: Array<{ at: number; seconds: number }> = []
  let clock = startAt

  const playback = createPlayback({
    now: () => clock,
    play: (audio, at) => void scheduled.push({ at, seconds: audio.length / RATE }),
    sampleRate: RATE,
    cushionSeconds: 0.05,
  })

  return { playback, scheduled, tick: (to: number) => void (clock = to), now: () => clock }
}

describe('scheduling speech that arrives unevenly', () => {
  it('starts the first chunk a cushion after now, not this instant', () => {
    // A chunk scheduled for right now is already late by the time the device
    // handles it, and a late chunk is clipped or dropped.
    const { playback, scheduled } = harness(10)
    playback.push(chunk(0.5))

    expect(scheduled[0]?.at).toBeCloseTo(10.05, 5)
  })

  it('butts each chunk against the end of the last one', () => {
    // The whole point: the gaps between arrivals must not become gaps in the
    // speech, or a perfectly synthesised sentence stutters.
    const { playback, scheduled } = harness(10)

    playback.push(chunk(0.5))
    playback.push(chunk(0.25))
    playback.push(chunk(1))

    expect(scheduled[1]?.at).toBeCloseTo(10.55, 5)
    expect(scheduled[2]?.at).toBeCloseTo(10.8, 5)
  })

  it('keeps them back to back even when they arrive late', () => {
    const { playback, scheduled, tick } = harness(10)

    playback.push(chunk(1))
    // Arrived a third of a second later, but still inside what is queued.
    tick(10.33)
    playback.push(chunk(1))

    expect(scheduled[1]?.at).toBeCloseTo(11.05, 5)
  })

  it('restarts from now once the queue has actually drained', () => {
    // Scheduling into a moment that has already passed is how the tail of a
    // conversation ends up playing all at once.
    const { playback, scheduled, tick } = harness(10)

    playback.push(chunk(0.5))
    tick(30)
    playback.push(chunk(0.5))

    expect(scheduled[1]?.at).toBeCloseTo(30.05, 5)
  })

  it('reports when it will have finished', () => {
    const { playback } = harness(10)

    playback.push(chunk(0.5))
    playback.push(chunk(0.5))

    expect(playback.endsAt).toBeCloseTo(11.05, 5)
  })

  it('knows whether it is still going', () => {
    const { playback, tick } = harness(10)
    expect(playback.playing).toBe(false)

    playback.push(chunk(1))
    expect(playback.playing).toBe(true)

    tick(12)
    expect(playback.playing).toBe(false)
  })

  it('ignores an empty chunk rather than scheduling nothing', () => {
    const { playback, scheduled } = harness(10)

    playback.push(new Float32Array(0))

    expect(scheduled).toEqual([])
    expect(playback.endsAt).toBe(0)
  })
})

describe('when the caller interrupts', () => {
  it('forgets what was queued so the next answer starts immediately', () => {
    // Without this the new answer is scheduled after the abandoned one, and
    // the caller waits through the silence of speech that was never played.
    const { playback, scheduled, tick } = harness(10)

    playback.push(chunk(5))
    playback.clear()
    tick(10.1)
    playback.push(chunk(0.5))

    expect(scheduled[1]?.at).toBeCloseTo(10.15, 5)
    expect(playback.endsAt).toBeCloseTo(10.65, 5)
  })

  it('is safe on a queue that was never used', () => {
    const { playback } = harness(10)

    playback.clear()

    expect(playback.playing).toBe(false)
  })
})
