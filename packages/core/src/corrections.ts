/**
 * A wrong answer, fixed by the person who noticed it.
 *
 * This is the loop every working deployment of one of these has, and the one
 * this library was missing. The agent says something wrong. The person who
 * knows it is wrong is on the support team, and until now they could do nothing
 * about it: the knowledge base is a file built at deploy time, so fixing it
 * meant a ticket, an engineer, and a release. By the time it shipped the same
 * wrong answer had gone out a hundred more times.
 *
 * A correction is read at question time and takes effect on the next message.
 * Nothing is rebuilt and nothing is re-embedded, which is the whole point: the
 * fix has to be available to somebody who cannot deploy.
 *
 * Corrections outrank the documentation deliberately. Somebody wrote this down
 * on purpose, about a specific thing that went wrong, which is better evidence
 * than a page that happened to match some words.
 */

import { tokenize } from './knowledge/tokenize.js'
import { expandQuery } from './retrieve/synonyms.js'
import type { Match } from './types.js'

export interface Correction {
  id: string
  /**
   * What was asked, in the customer's words.
   *
   * The wording that went wrong, not a tidied version of it. This is matched
   * against what the next customer types, and the phrasing that failed is the
   * phrasing most likely to come back.
   */
  question: string
  /** What the agent should have said. */
  answer: string
  /** Who wrote it, for the audit trail. Never shown to a customer. */
  author?: string
  createdAt: string
}

/**
 * Where corrections live.
 *
 * Deliberately not part of `Store`. Adding a method there would break every
 * implementation of it that exists, for something a deployment can reasonably
 * not have. Anything satisfying this works: a table, a JSON file, a CMS.
 */
export interface CorrectionStore {
  list(): Promise<Correction[]>
  add(correction: Omit<Correction, 'id' | 'createdAt'>): Promise<Correction>
  remove(id: string): Promise<boolean>
}

/**
 * Corrections held in memory, for a single process.
 *
 * Fine for one server and a modest number of them; wrong the moment there are
 * two, because a correction written on one would not exist on the other. Back
 * it with the database you already have when you scale past one.
 */
export function memoryCorrections(initial: Correction[] = []): CorrectionStore {
  const held = [...initial]

  return {
    async list() {
      return [...held]
    },

    async add(correction) {
      const saved: Correction = {
        ...correction,
        id: `cor_${Math.random().toString(36).slice(2, 12)}`,
        createdAt: new Date().toISOString(),
      }
      held.unshift(saved)

      return saved
    },

    async remove(id) {
      const at = held.findIndex((correction) => correction.id === id)
      if (at < 0) return false
      held.splice(at, 1)

      return true
    },
  }
}

/**
 * How much of a correction's wording a question has to share before it applies.
 *
 * Two thirds, which is strict on purpose. A correction is a hand-written
 * override that beats the documentation, so a loose match does real damage: it
 * answers a question nobody corrected with an answer written for a different
 * one. Retrieval can afford to be generous because ranking sorts it out; this
 * cannot, because it wins by construction.
 */
const OVERLAP = 0.66

/**
 * The correction that answers this question, if one does.
 *
 * Matched on the customer's own words rather than by embedding, and that is not
 * a shortcut. Somebody wrote this correction against a specific question that
 * came in; the next person asking the same thing usually asks it the same way.
 * A vector match here would quietly widen a hand-written override to questions
 * nobody checked it against.
 */
export function correctionFor(question: string, corrections: Correction[]): Correction | undefined {
  const asked = new Set(tokenize(expandQuery(question)))
  if (asked.size === 0) return undefined

  let best: { correction: Correction; score: number } | undefined

  for (const correction of corrections) {
    const wanted = tokenize(correction.question)
    if (wanted.length === 0) continue

    let shared = 0
    for (const term of new Set(wanted)) {
      if (asked.has(term)) shared++
    }

    const score = shared / new Set(wanted).size
    if (score < OVERLAP) continue
    if (!best || score > best.score) best = { correction, score }
  }

  return best?.correction
}

/**
 * A correction as a source the agent can cite.
 *
 * Given the same shape as a retrieved passage so nothing downstream has to know
 * the difference: it is screened, cited and counted exactly like a page. The
 * title says where it came from, because a support lead reading a transcript
 * needs to know the answer was written by their team rather than found in the
 * documentation.
 */
export function asMatch(correction: Correction): Match {
  return {
    chunk: {
      id: `correction:${correction.id}`,
      docId: `correction:${correction.id}`,
      title: 'Correction from the support team',
      text: correction.answer,
      meta: { correction: true },
    },
    // Above anything retrieval produces. Somebody wrote this deliberately about
    // a thing that went wrong, which beats a page that happened to match words.
    score: 1,
    from: ['keyword'],
  }
}
