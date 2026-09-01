/**
 * Working out when the caller has finished speaking.
 *
 * On a phone line somebody else's platform decides this. Owning the transport
 * means owning the decision, and it is the one that makes a call feel like a
 * conversation or like talking to a machine. Cut too early and the agent talks
 * over the end of a sentence. Cut too late and every exchange has a hole in it.
 *
 * The transcriber takes a finished clip rather than a stream, so something has
 * to decide where the clip ends. That is all this does: it is handed the volume
 * of each small slice of audio and says when a turn started, when it ended, and
 * when the caller has begun talking over the agent.
 *
 * Deliberately arithmetic over numbers rather than anything to do with audio
 * hardware, so it can be tested exhaustively without a microphone. The caller
 * converts samples to a level with `levelOf` and feeds them here.
 */

/** What the detector noticed, in the order it noticed it. */
export type TurnEvent =
  | { type: 'speech-start' }
  | { type: 'turn-end'; speechMs: number }
  /** The caller started talking while the agent was. Stop the agent. */
  | { type: 'barge-in' }

export interface TurnOptions {
  /**
   * Quiet needed to call a turn finished.
   *
   * The trade is direct: shorter feels responsive and clips people who pause
   * mid-thought, longer is patient and leaves a gap after every sentence.
   * Production voice agents land around here.
   */
  endOfTurnSilenceMs?: number
  /**
   * Sound needed before a noise counts as somebody talking.
   *
   * Without this a cough, a door, or one loud keystroke starts a turn, and the
   * agent answers a question nobody asked.
   */
  minSpeechMs?: number
  /**
   * How far above the room's own noise a slice has to be to count as speech.
   *
   * Relative rather than absolute, because a fixed threshold that works in a
   * quiet room hears a café as one continuous sentence, and one that works in
   * a café is deaf to somebody speaking softly at home.
   */
  marginOverNoise?: number
  /**
   * Speech needed to treat the caller as interrupting rather than as having
   * said "mm" while listening. Backchannel noise is short; an interruption is
   * somebody committing to a sentence.
   */
  bargeInMs?: number
  /**
   * Longest a single turn may run before it is cut.
   *
   * A safety valve rather than a feature. If the room sits above the threshold
   * the detector never sees silence and would otherwise wait forever.
   */
  maxTurnMs?: number
}

export interface TurnDetector {
  /** One slice of audio. Returns whatever it decided, usually nothing. */
  push(level: number, durationMs: number): TurnEvent[]
  /** Tell it whether the agent is talking, so it can spot an interruption. */
  setAgentSpeaking(speaking: boolean): void
  /** The room's current noise level, which it learns as it goes. */
  readonly noiseFloor: number
  reset(): void
}

/**
 * Loudness of a slice of 16-bit audio, from 0 to 1.
 *
 * Root mean square rather than peak: a single loud sample is a click, and what
 * matters here is whether there is sustained sound.
 */
export function levelOf(samples: Int16Array): number {
  if (samples.length === 0) return 0

  let sum = 0
  for (const sample of samples) sum += sample * sample

  return Math.min(1, Math.sqrt(sum / samples.length) / 32768)
}

export function createTurnDetector(options: TurnOptions = {}): TurnDetector {
  const endOfTurnSilenceMs = options.endOfTurnSilenceMs ?? 700
  const minSpeechMs = options.minSpeechMs ?? 200
  const marginOverNoise = options.marginOverNoise ?? 0.02
  const bargeInMs = options.bargeInMs ?? 300
  const maxTurnMs = options.maxTurnMs ?? 20_000

  /**
   * The room, taken as the quietest it has recently been while nobody spoke.
   *
   * Two versions of this were wrong before this one. Drifting toward the
   * current level during silence could only ever fall, so a room loud enough
   * to matter never moved it. Taking the minimum across every slice was worse:
   * with sustained sound the floor climbed to meet the speech and the detector
   * went deaf halfway through a sentence.
   *
   * Only silence updates it, which is circular but works, because it starts
   * low and real speech has gaps. The honest limit is that a room loud enough
   * to sit permanently above the threshold never yields a silent slice at all,
   * and nothing here can learn its way out of that. `maxTurnMs` below is what
   * stops that case hanging rather than pretending to solve it.
   */
  const BUCKET_MS = 500
  const BUCKETS = 6
  const recent: number[] = []
  let bucketMin = Infinity
  let bucketMs = 0
  let noiseFloor = 0.01
  let speaking = false
  let speechMs = 0
  let silenceMs = 0
  let agentSpeaking = false
  let bargeInMs_ = 0
  let announced = false

  return {
    get noiseFloor() {
      return noiseFloor
    },

    setAgentSpeaking(next: boolean) {
      agentSpeaking = next
      if (!next) bargeInMs_ = 0
    },

    push(level: number, durationMs: number): TurnEvent[] {
      const events: TurnEvent[] = []
      const loud = level > noiseFloor + marginOverNoise

      // Only quiet slices teach it what quiet sounds like.
      if (!loud) {
        bucketMin = Math.min(bucketMin, level)
        bucketMs += durationMs

        if (bucketMs >= BUCKET_MS) {
          recent.push(bucketMin)
          if (recent.length > BUCKETS) recent.shift()
          noiseFloor = Math.min(...recent)
          bucketMin = Infinity
          bucketMs = 0
        }
      }

      // An interruption is judged on its own clock. The caller may have been
      // silent for a while, so the turn counters below say nothing about it.
      if (agentSpeaking) {
        bargeInMs_ = loud ? bargeInMs_ + durationMs : 0

        if (bargeInMs_ >= bargeInMs) {
          bargeInMs_ = 0
          events.push({ type: 'barge-in' })
        }
      }

      if (loud) {
        speechMs += durationMs
        silenceMs = 0

        // Nobody speaks for this long without drawing breath, so a run this
        // size means the threshold is below the room rather than that somebody
        // is still talking. Ending the turn keeps the call moving instead of
        // waiting for a silence that is never coming.
        if (speaking && speechMs >= maxTurnMs) {
          events.push({ type: 'turn-end', speechMs })
          speaking = false
          announced = false
          speechMs = 0

          return events
        }

        // Held back until there is enough of it to be a person rather than a
        // noise, so a cough never opens a turn.
        if (!announced && speechMs >= minSpeechMs) {
          announced = true
          speaking = true
          events.push({ type: 'speech-start' })
        }

        return events
      }

      silenceMs += durationMs

      if (speaking && silenceMs >= endOfTurnSilenceMs) {
        events.push({ type: 'turn-end', speechMs })
        speaking = false
        announced = false
        speechMs = 0
        silenceMs = 0
      }

      // Noise that never became a turn is forgotten, so three coughs a second
      // apart do not add up to a sentence.
      if (!speaking && silenceMs >= endOfTurnSilenceMs) speechMs = 0

      return events
    },

    reset() {
      recent.length = 0
      bucketMin = Infinity
      bucketMs = 0
      speaking = false
      announced = false
      speechMs = 0
      silenceMs = 0
      bargeInMs_ = 0
      agentSpeaking = false
    },
  }
}
