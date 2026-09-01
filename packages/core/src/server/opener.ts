/**
 * Cutting the throat-clearing off the front of an answer.
 *
 * The instructions already ask for this, and a large model obeys. A small one
 * opens with "Certainly! I'd be happy to help with that." and then answers,
 * which is the single most common complaint about a support bot sounding like
 * a bot. An instruction a model may ignore is not a guarantee, so this is the
 * guarantee.
 *
 * Only the opening. A "thanks" in the middle of a sentence is a person being
 * polite; the same word at the front of every reply is a tic. Trying to find
 * them anywhere would eventually cut a word out of a real answer, and a filter
 * that damages good text is worse than the tic it removes.
 *
 * It costs no latency on a good answer. Text is held only while what has
 * arrived so far could still turn out to be one of these, so a reply that
 * opens with the answer is released on the first chunk.
 */

/**
 * The openers worth removing, lowercased and without their punctuation.
 *
 * Kept short on purpose. Every entry here is a phrase that carries nothing:
 * remove it and the answer is unchanged. Anything that might be doing work in
 * some sentence somewhere does not belong on this list.
 */
const OPENERS = [
  'certainly',
  'absolutely',
  'sure',
  'of course',
  'great question',
  "that's a great question",
  'thanks for asking',
  'thank you for asking',
  'thanks for reaching out',
  'thank you for reaching out',
  'happy to help',
  "i'd be happy to help",
  'i would be happy to help',
  "i'm happy to help",
  'i can certainly help',
  'i can help with that',
  'no problem',
  'as an ai',
  'as an ai assistant',
  'as an ai language model',
]

/** The longest thing we might be looking at, so we know when to stop waiting. */
const LONGEST = Math.max(...OPENERS.map((phrase) => phrase.length)) + 24

export interface OpenerFilter {
  /** Text to send on, which may be nothing while it waits to decide. */
  push(text: string): string
  /** Whatever is still held, at the end of the stream. */
  flush(): string
}

/**
 * Strips a leading pleasantry from a stream, once.
 *
 * After the first release everything passes through untouched, because the
 * decision has been made and re-examining the middle of an answer is how a
 * filter starts eating real words.
 */
export function createOpenerFilter(): OpenerFilter {
  let held = ''
  let decided = false

  return {
    push(text: string): string {
      if (decided) return text

      held += text
      const trimmed = held.replace(/^[\s]+/, '')
      const lowered = trimmed.toLowerCase()

      if (trimmed.length < LONGEST && undecided(lowered)) return ''

      const stripped = strip(trimmed)

      // Removing one can reveal the next, half-arrived: "Certainly! Happy to
      // he..." leaves "Happy to he", which is not yet enough to judge. Keep
      // holding rather than releasing a fragment and stopping.
      if (stripped.length < LONGEST && undecided(stripped.toLowerCase())) {
        held = stripped

        return ''
      }

      decided = true
      held = ''

      return stripped
    },

    flush(): string {
      if (decided) return ''

      decided = true
      const trimmed = held.replace(/^[\s]+/, '')
      held = ''

      return strip(trimmed)
    },
  }
}

/**
 * Whether more text could still change the answer.
 *
 * Two reasons to wait. What has arrived might be the beginning of a longer
 * phrase, so "cert" waits to see whether it becomes "certainly". And a phrase
 * that has just completed with nothing after it yet has to wait too: the rule
 * that keeps a pleasantry which is the entire reply cannot tell "Of course!"
 * from the first four words of "Of course! Your order shipped" until it sees
 * what follows.
 */
function undecided(lowered: string): boolean {
  return OPENERS.some((phrase) => {
    // Could still grow into this phrase.
    if (lowered.length < phrase.length) return phrase.startsWith(lowered)

    // Is this phrase, and nothing has arrived after it to judge it by.
    return lowered === phrase || /^[\s,.!:;-]*$/.test(lowered.slice(phrase.length))
      ? lowered.startsWith(phrase)
      : false
  })
}

/**
 * Removes one leading pleasantry and the punctuation holding it on.
 *
 * Longest first, so "i'd be happy to help" is not left as "to help" by the
 * shorter "happy to help" matching inside it.
 */
function strip(text: string): string {
  const lowered = text.toLowerCase()

  for (const phrase of [...OPENERS].sort((a, b) => b.length - a.length)) {
    if (!lowered.startsWith(phrase)) continue

    const after = text.slice(phrase.length)
    // Punctuation, not merely a space. This is the line that separates
    // throat-clearing from a word doing work: "Certainly! Delivery is..." is a
    // tic, and "Absolutely everything is covered" is an answer. A space alone
    // ate the adverb and left the sentence meaning less than it did.
    if (after && !/^[,.!:;]/.test(after)) continue

    const rest = after.replace(/^[\s,.!:;-]+/, '')
    // Nothing but the pleasantry. Keep it: an answer of "" is worse than one
    // that is merely polite, and this happens on a greeting, where "Sure" or
    // "Of course" is the whole correct reply.
    if (!rest) return text

    // Recursed, because they stack: "Certainly! Happy to help. Your order..."
    return strip(rest.charAt(0).toUpperCase() + rest.slice(1))
  }

  return text
}
