/**
 * Playing audio that arrives when it arrives.
 *
 * Speech comes back a sentence at a time over a network, so the gaps between
 * chunks are whatever the network and the synthesiser felt like. Playing each
 * one "now" as it lands puts those gaps into the middle of the sentence, and
 * the result is a voice that stutters even though every chunk is perfect.
 *
 * The fix is to keep a clock. Each chunk is scheduled to begin exactly where
 * the previous one ends, so a run of chunks plays as continuous speech no
 * matter how unevenly they turned up. When the queue has been empty long
 * enough that the clock is in the past, it restarts from now plus a small
 * cushion, which is the buffer that absorbs the next bit of jitter.
 *
 * Arithmetic over a clock, with the actual playing behind a function, so the
 * scheduling can be tested exhaustively without an audio device.
 */

export interface PlaybackOptions {
  /** The audio clock, in seconds. An AudioContext's `currentTime`. */
  now: () => number
  /** Starts one chunk at the given time on that clock. */
  play: (chunk: Float32Array, at: number) => void
  /**
   * How far ahead of now a restarted queue begins.
   *
   * Straight away is too soon: a chunk scheduled for this instant is late by
   * the time it is handled, and a late chunk is dropped or clipped. This is
   * the cushion that absorbs the next arrival being slightly slower.
   */
  cushionSeconds?: number
  /** Samples per second the chunks are in, for working out their length. */
  sampleRate: number
}

export interface Playback {
  /** Queue one chunk, scheduled after whatever is already queued. */
  push(chunk: Float32Array): void
  /** When everything queued will have finished, on the audio clock. */
  readonly endsAt: number
  /** True while there is audio queued that has not finished. */
  readonly playing: boolean
  /** Drop everything queued. Used when the caller interrupts. */
  clear(): void
}

export function createPlayback(options: PlaybackOptions): Playback {
  const cushion = options.cushionSeconds ?? 0.05
  /** Where the next chunk goes. Zero means the queue is not running. */
  let nextAt = 0

  return {
    get endsAt() {
      return nextAt
    },

    get playing() {
      return nextAt > options.now()
    },

    push(chunk: Float32Array) {
      if (chunk.length === 0) return

      const now = options.now()
      // Behind the clock means the queue drained while nothing was arriving,
      // so this chunk starts a fresh run rather than being scheduled into a
      // moment that has already passed.
      const at = nextAt > now ? nextAt : now + cushion

      options.play(chunk, at)
      nextAt = at + chunk.length / options.sampleRate
    },

    clear() {
      // Only the clock is reset. Chunks already handed to the device are
      // stopped by the caller, which owns them and knows how.
      nextAt = 0
    },
  }
}
