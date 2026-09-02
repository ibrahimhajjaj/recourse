/**
 * The end of the last complete sentence.
 *
 * Checking a partial sentence is checking text the model has not finished
 * writing, which produces verdicts on things that were never said.
 */
/**
 * Stops in the scripts this agent is told to reply in, plus the ideographic
 * and Arabic ones that carry no trailing space. Latin stops need a space or
 * the end of the text after them, or every decimal point and "e.g." would end
 * a sentence; the others are unambiguous on their own.
 */
const STOPS = '.!?'
const STOPS_ALONE = '。！？؟۔।॥…'

export function lastBoundary(text: string): number {
  for (let index = text.length - 1; index >= 0; index--) {
    const character = text[index] as string

    if (STOPS_ALONE.includes(character)) return index + 1

    // A line that has ended is a complete thought too, and it is the only
    // boundary a list, a table or a fenced code block ever offers. Without it
    // an answer made of bullets is screened as one block at the very end,
    // which turns streaming off for that answer and says nothing.
    if (character === '\n') return index + 1

    if (!STOPS.includes(character)) continue
    // A stop only ends a sentence if something follows it, or nothing does.
    const next = text[index + 1]
    if (next === undefined || /\s/.test(next)) return index + 1
  }
  return 0
}

/** Reasons come from parsers that may or may not punctuate. One stop, not two. */
export function trimStop(reason: string): string {
  return reason.replace(/[.\s]+$/, '')
}
