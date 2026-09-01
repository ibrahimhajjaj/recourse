/**
 * Turning an answer written for a screen into something worth hearing.
 *
 * The agent's replies are markdown with inline citations, which is right in a
 * chat panel and wrong on a phone: a text-to-speech engine reads "**refunds**"
 * as "asterisk asterisk refunds" and "[1]" as "one". Neither is recoverable by
 * the listener, so the cleaning happens here rather than by asking the model
 * nicely not to do it.
 */

/** Citation markers, which mean nothing out loud. */
const CITATION = /\s*\[\d{1,2}\]/g
/** Fenced code, which is unspeakable and usually long. */
const FENCE = /```[\s\S]*?```/g

export function toSpeech(text: string): string {
  return text
    .replace(FENCE, ' ')
    .replace(CITATION, '')
    // Links become their label; the url is noise on a call.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|\n)\s*#{1,6}\s*/g, '$1')
    // A table is the worst thing a screen can hand a speaker. The separator
    // row is pure punctuation and is dropped; a data row becomes its cells
    // separated by commas, which a speech engine reads as the pauses a reader
    // gets from the column edges. Without this a delivery table is read out as
    // "pipe United Kingdom pipe Royal Mail pipe".
    .replace(/(^|\n)\s*\|[\s:|-]*\|\s*(?=\n|$)/g, '$1')
    .replace(/(^|\n)[^\S\n]*\|(.+?)\|[^\S\n]*(?=\n|$)/g, (_all, start: string, row: string) =>
      `${start}${row
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(', ')}`,
    )
    // A bullet becomes a pause, so a list does not run together.
    .replace(/(^|\n)\s*[-*+]\s+/g, '$1')
    .replace(/(^|\n)\s*\d+[.)]\s+/g, '$1')
    // Newlines survive as pauses: flattening a paragraph break to a space runs
    // sentences together in a way the listener hears as breathless. Order
    // matters here, and getting it wrong reintroduces the blank lines that
    // trimming the surrounding spaces was meant to remove.
    .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim()
}

/**
 * Buffers streamed deltas into whole sentences.
 *
 * Two reasons not to forward raw deltas. Markdown arrives split across them, so
 * a `**` can be cut in half and survive any per-delta cleaning. And a speech
 * engine given three-character fragments produces flat, choppy prosody, while
 * a whole sentence gets the intonation right.
 */
export function createSentenceBuffer(options: { maxChars?: number; firstChunkChars?: number } = {}) {
  const maxChars = options.maxChars ?? 180
  /**
   * The first utterance goes out sooner than the rest.
   *
   * A caller hears silence from the moment they stop speaking until the first
   * word arrives, and a one-sentence answer has no interior boundary to break
   * on, so waiting for the full stop means waiting for the entire reply. This
   * releases the opening clause at a comma once there is enough of it to sound
   * deliberate, and everything after it streams on sentence boundaries.
   */
  const firstChunkChars = options.firstChunkChars ?? 70
  let buffer = ''
  let emitted = false

  return {
    /** Feeds a delta, returning any sentences now complete. */
    push(delta: string): string[] {
      buffer += delta
      const out: string[] = []

      while (true) {
        // A boundary is terminal punctuation followed by a space or newline,
        // which avoids splitting "3.5kg" or "e.g." mid-number.
        const match = /[.!?]["')\]]?[\s\n]/.exec(buffer)

        if (match) {
          const end = match.index + match[0].length
          const sentence = toSpeech(buffer.slice(0, end))
          buffer = buffer.slice(end)
          if (sentence) {
            emitted = true
            out.push(sentence)
          }
          continue
        }

        // Release the opening clause early, on a comma, so audio starts while
        // the rest of the answer is still being generated.
        if (!emitted && buffer.length >= firstChunkChars) {
          const comma = buffer.lastIndexOf(', ', maxChars)
          if (comma > 30) {
            const chunk = toSpeech(buffer.slice(0, comma + 1))
            buffer = buffer.slice(comma + 2)
            if (chunk) {
              emitted = true
              out.push(chunk)
              continue
            }
          }
        }

        // A very long clause with no punctuation still has to be said, so cut
        // it at the last space rather than leaving the caller in silence.
        if (buffer.length > maxChars) {
          const cut = buffer.lastIndexOf(' ', maxChars)
          const end = cut > 40 ? cut + 1 : maxChars
          const chunk = toSpeech(buffer.slice(0, end))
          buffer = buffer.slice(end)
          if (chunk) {
            emitted = true
            out.push(chunk)
          }
          continue
        }

        break
      }

      return out
    },

    /** Everything still held, cleaned. Call at the end of a turn. */
    flush(): string {
      const remaining = toSpeech(buffer)
      buffer = ''
      emitted = false
      return remaining
    },

    pending(): string {
      return buffer
    },
  }
}
