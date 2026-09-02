/**
 * The words a customer uses, against the words the page was written in.
 *
 * This is the one failure a keyword index cannot argue its way out of. Somebody
 * asks how to get their money back; the page says "refund" and never once says
 * "money back"; nothing matches, and the agent says it cannot find anything
 * about a policy sitting right there in the index.
 *
 * Embeddings solve it properly, and where there is an embedder this does very
 * little. It exists for the path with no credentials at all, which is the one
 * most people start on and some never leave.
 *
 * Applied to the question, never to the pages. Expanding at ingest would bake
 * today's guesses into the index and make them impossible to change without a
 * rebuild; expanding the question costs nothing and can be corrected the moment
 * somebody notices it is wrong.
 */

/**
 * Words that mean the same thing to somebody asking a support question.
 *
 * Each line is a group, and any member found in a question brings in the rest.
 * Deliberately short. Every entry is a guess about somebody else's content, and
 * a wrong guess pulls the wrong page to the top of a real customer's answer, so
 * the bar is "no support site could reasonably mean something else by this".
 *
 * English only, and not apologetically: these are English words. A business
 * writing in another language passes its own, which is also how anybody adds
 * the vocabulary this cannot know about, like their own product names.
 */
const GROUPS: string[][] = [
  ['refund', 'money back', 'reimburse'],
  ['delivery', 'shipping', 'postage'],
  ['broken', 'faulty', 'damaged', 'defective'],
  ['cancel', 'cancellation'],
  ['invoice', 'receipt', 'bill'],
  ['password', 'passcode', 'log in', 'login', 'sign in'],
]

/** A phrase to look for, and what to add when it is there. */
type Expansion = { find: RegExp; add: string }

function compile(groups: string[][]): Expansion[] {
  const out: Expansion[] = []

  for (const group of groups) {
    for (const phrase of group) {
      const others = group.filter((other) => other !== phrase)
      if (others.length === 0) continue

      // Whole words only. Without the boundaries "bill" matches "billing
      // address" and "login" matches "logging", and both add terms that pull
      // the wrong page up.
      out.push({
        find: new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
        add: others.join(' '),
      })
    }
  }

  return out
}

const DEFAULTS = compile(GROUPS)

/** Extra groups a deployment adds, in the same shape as the built-in ones. */
export type SynonymGroups = string[][]

/**
 * The question, plus the words the pages might have used instead.
 *
 * Added rather than substituted, because the customer's own words are usually
 * right and a document using them should still win. Ranking sorts it out: a
 * page matching what was actually asked matches more terms than one matching
 * only a synonym.
 */
export function expandQuery(query: string, extra?: SynonymGroups | false): string {
  if (extra === false) return query

  const rules = extra ? [...DEFAULTS, ...compile(extra)] : DEFAULTS
  const added: string[] = []

  for (const rule of rules) {
    if (rule.find.test(query)) added.push(rule.add)
  }

  if (added.length === 0) return query

  return `${query} ${added.join(' ')}`
}
