/**
 * Deciding whether an answer was right.
 *
 * Every check here is deterministic: string matching, regex, citation counting,
 * which actions ran. No model grades another model by default, because a judge
 * that disagrees with itself between runs turns a regression suite into a mood
 * ring. A judge is available for the cases that genuinely need one, and it is
 * never the model under test.
 */

import type { EvalCase, CaseResult } from './case.js'

export interface Observed {
  answer: string
  /** Citation numbers the answer used, in order of appearance. */
  cited: number[]
  /** Names of actions that ran. */
  actions: string[]
  /** Document ids retrieval returned, best first. */
  retrieved: string[]
  /** Set when the agent refused before generating. */
  refused: boolean
  ms: number
}

/**
 * A pattern is a plain substring unless it is written `/like this/i`, which is
 * how a suite expresses "any of these words" without a second field.
 */
function matches(text: string, pattern: string): boolean {
  const regex = /^\/(.+)\/([gimsuy]*)$/.exec(pattern)
  if (regex) return new RegExp(regex[1] as string, regex[2]).test(text)
  return text.toLowerCase().includes(pattern.toLowerCase())
}

export function grade(item: EvalCase, observed: Observed): CaseResult {
  const failures: string[] = []
  const answer = observed.answer

  for (const pattern of item.mustContain ?? []) {
    if (!matches(answer, pattern)) failures.push(`missing ${JSON.stringify(pattern)}`)
  }

  for (const pattern of item.mustNotContain ?? []) {
    if (matches(answer, pattern)) failures.push(`contains ${JSON.stringify(pattern)}`)
  }

  if (item.mustCite && observed.cited.length === 0) {
    failures.push('cited nothing')
  }

  // A citation pointing at a source that was never retrieved is a fabricated
  // one, which is worse than not citing at all: it is a claim of provenance
  // the reader cannot check.
  for (const number of observed.cited) {
    if (number < 1 || number > observed.retrieved.length) {
      failures.push(`cited [${number}] but only ${observed.retrieved.length} sources were retrieved`)
    }
  }

  if (item.mustRefuse && !observed.refused) {
    failures.push('answered when it should have declined')
  }

  if (item.mustCallAction && !observed.actions.includes(item.mustCallAction)) {
    failures.push(
      `did not call ${item.mustCallAction}${observed.actions.length > 0 ? ` (called ${observed.actions.join(', ')})` : ''}`,
    )
  }

  // Named, not just counted. "Called nothing" and "called the wrong one" are
  // different failures and a report that says which is the one worth reading.
  for (const name of [item.mustNotCallAction ?? []].flat()) {
    if (observed.actions.includes(name)) {
      failures.push(`called ${name}, which it must not (called ${observed.actions.join(', ')})`)
    }
  }

  if (item.mustCallActionTimes) {
    const { name, times } = item.mustCallActionTimes
    const ran = observed.actions.filter((called) => called === name).length

    if (ran !== times) {
      failures.push(`called ${name} ${ran} times, expected ${times}`)
    }
  }

  for (const id of item.mustRetrieve ?? []) {
    if (!observed.retrieved.some((found) => found === id || found.startsWith(`${id}#`))) {
      failures.push(`did not retrieve ${id} (got ${observed.retrieved.slice(0, 4).join(', ') || 'nothing'})`)
    }
  }

  for (const id of item.mustNotRetrieve ?? []) {
    if (observed.retrieved.some((found) => found === id || found.startsWith(`${id}#`))) {
      failures.push(`retrieved ${id}, which it should not have`)
    }
  }

  return {
    case: item,
    passed: failures.length === 0,
    failures,
    answer,
    cited: observed.cited.length,
    actions: observed.actions,
    retrieved: observed.retrieved,
    ms: observed.ms,
  }
}

/** The `[n]` markers an answer used, deduplicated, in order. */
export function citationsIn(text: string): number[] {
  const seen = new Set<number>()
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    seen.add(Number.parseInt(match[1] as string, 10))
  }
  return [...seen]
}

/**
 * Whether an answer is the agent declining.
 *
 * Matched against the fallback the suite configured plus the classifier's own
 * refusal lines, rather than by looking for the word "sorry": a real answer
 * that happens to apologise for a delay is not a refusal.
 */
export function isRefusal(text: string, fallbacks: string[]): boolean {
  const normalised = text.trim().toLowerCase()
  if (normalised.length === 0) return false
  return fallbacks.some((fallback) => normalised.includes(fallback.trim().toLowerCase().slice(0, 40)))
}
