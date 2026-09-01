import { describe, expect, it } from 'vitest'
import { createTurnDetector, levelOf, type TurnEvent } from '../src/channels/voice-turns.js'

/** One slice of audio, 20ms, which is what a capture worklet hands over. */
const SLICE = 20

/** Feeds a run of slices at one level and collects what came back. */
function feed(detector: ReturnType<typeof createTurnDetector>, level: number, ms: number): TurnEvent[] {
  const events: TurnEvent[] = []
  for (let elapsed = 0; elapsed < ms; elapsed += SLICE) events.push(...detector.push(level, SLICE))

  return events
}

const QUIET = 0.005
const TALKING = 0.2

describe('measuring how loud a slice is', () => {
  it('is zero for silence and one for a full-scale tone', () => {
    expect(levelOf(new Int16Array(160))).toBe(0)
    expect(levelOf(Int16Array.from({ length: 160 }, () => 32767))).toBeCloseTo(1, 2)
  })

  it('is empty-safe, since a stream can hand over nothing', () => {
    expect(levelOf(new Int16Array(0))).toBe(0)
  })

  it('reads sustained sound rather than one loud sample', () => {
    // A click is one spike in an otherwise quiet slice, and treating it as
    // speech is how a keyboard starts a turn.
    const click = new Int16Array(160)
    click[0] = 32767

    expect(levelOf(click)).toBeLessThan(0.1)
  })
})

describe('deciding when somebody has finished speaking', () => {
  it('opens a turn once there is enough sound to be a person', () => {
    const turns = createTurnDetector()

    expect(feed(turns, TALKING, 100)).toEqual([])
    expect(feed(turns, TALKING, 200)).toContainEqual({ type: 'speech-start' })
  })

  it('ignores a cough, which is the reason the minimum exists', () => {
    const turns = createTurnDetector({ minSpeechMs: 200 })

    const events = [...feed(turns, TALKING, 60), ...feed(turns, QUIET, 1000)]

    expect(events).toEqual([])
  })

  it('ends the turn after the configured quiet, and reports how long they spoke', () => {
    const turns = createTurnDetector({ endOfTurnSilenceMs: 700 })
    feed(turns, TALKING, 600)

    expect(feed(turns, QUIET, 500)).toEqual([])

    const ended = feed(turns, QUIET, 400)
    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatchObject({ type: 'turn-end' })
    expect((ended[0] as { speechMs: number }).speechMs).toBeGreaterThanOrEqual(600)
  })

  it('does not cut somebody off for pausing mid-sentence', () => {
    // The whole reason the window is hundreds of milliseconds rather than tens.
    const turns = createTurnDetector({ endOfTurnSilenceMs: 700 })
    feed(turns, TALKING, 400)

    const events = [...feed(turns, QUIET, 300), ...feed(turns, TALKING, 400)]

    expect(events.some((event) => event.type === 'turn-end')).toBe(false)
  })

  it('handles several turns in a row', () => {
    const turns = createTurnDetector()
    const ends = () => feed(turns, TALKING, 400).concat(feed(turns, QUIET, 900)).filter((e) => e.type === 'turn-end')

    expect(ends()).toHaveLength(1)
    expect(ends()).toHaveLength(1)
    expect(ends()).toHaveLength(1)
  })

  it('forgets noise that never became a turn', () => {
    // Three separate coughs a second apart must not add up to a sentence.
    const turns = createTurnDetector({ minSpeechMs: 200 })

    const events = [
      ...feed(turns, TALKING, 80),
      ...feed(turns, QUIET, 1000),
      ...feed(turns, TALKING, 80),
      ...feed(turns, QUIET, 1000),
      ...feed(turns, TALKING, 80),
      ...feed(turns, QUIET, 1000),
    ]

    expect(events).toEqual([])
  })
})

describe('talking over the agent', () => {
  it('reports an interruption once the caller commits to it', () => {
    const turns = createTurnDetector({ bargeInMs: 300 })
    turns.setAgentSpeaking(true)

    expect(feed(turns, TALKING, 200)).not.toContainEqual({ type: 'barge-in' })
    expect(feed(turns, TALKING, 200)).toContainEqual({ type: 'barge-in' })
  })

  it('ignores a listener saying "mm" while the agent talks', () => {
    const turns = createTurnDetector({ bargeInMs: 300 })
    turns.setAgentSpeaking(true)

    const events = [...feed(turns, TALKING, 100), ...feed(turns, QUIET, 200), ...feed(turns, TALKING, 100)]

    expect(events).not.toContainEqual({ type: 'barge-in' })
  })

  it('says nothing about interruptions while the agent is quiet', () => {
    const turns = createTurnDetector()

    expect(feed(turns, TALKING, 1000)).not.toContainEqual({ type: 'barge-in' })
  })

  it('starts the interruption clock fresh each time the agent speaks', () => {
    const turns = createTurnDetector({ bargeInMs: 300 })

    turns.setAgentSpeaking(true)
    feed(turns, TALKING, 200)
    turns.setAgentSpeaking(false)
    turns.setAgentSpeaking(true)

    expect(feed(turns, TALKING, 200)).not.toContainEqual({ type: 'barge-in' })
  })
})

describe('learning the room', () => {
  it('does not hang when the room never goes quiet', () => {
    // The honest limit: a room permanently above the threshold yields no silent
    // slice, so nothing can learn its way out of it. What it must not do is
    // wait forever for a silence that is never coming.
    const noisy = createTurnDetector({ maxTurnMs: 2000 })

    const events = feed(noisy, 0.08, 3000)

    expect(events).toContainEqual({ type: 'speech-start' })
    expect(events.some((event) => event.type === 'turn-end')).toBe(true)
  })

  it('keeps cutting turns in a room like that rather than stopping', () => {
    const noisy = createTurnDetector({ maxTurnMs: 1000 })
    const ends = feed(noisy, 0.08, 5000).filter((event) => event.type === 'turn-end')

    expect(ends.length).toBeGreaterThanOrEqual(3)
  })

  it('still hears somebody speaking softly at home', () => {
    const quiet = createTurnDetector()
    feed(quiet, 0.002, 2000)

    expect(quiet.noiseFloor).toBeLessThan(0.01)
    expect(feed(quiet, 0.05, 400)).toContainEqual({ type: 'speech-start' })
  })

  it('does not learn that speech is the background', () => {
    // Adapting while somebody talks is how a detector goes deaf mid-call.
    const turns = createTurnDetector()
    const before = turns.noiseFloor
    feed(turns, TALKING, 2000)

    expect(turns.noiseFloor).toBeLessThanOrEqual(before)
  })
})

describe('starting over', () => {
  it('drops a half-finished turn', () => {
    const turns = createTurnDetector()
    feed(turns, TALKING, 400)
    turns.reset()

    expect(feed(turns, QUIET, 1000)).toEqual([])
  })
})
