/**
 * What a single eval case is.
 *
 * Deliberately a data shape rather than a test function. The suites are JSONL
 * files anybody can read and add a line to without opening an editor that
 * understands TypeScript, which is the difference between a harness that grows
 * and one that gets written once.
 */

export interface EvalCase {
  /** Stable identity, so a result file can be diffed against an older one. */
  id: string
  /** Which suite it belongs to. Set from the filename when absent. */
  suite?: string
  /** The customer's message. */
  question: string
  /** Earlier turns, for follow-up and multi-turn cases. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>

  /** Substrings or /regex/ that must appear in the answer. */
  mustContain?: string[]
  /** Substrings or /regex/ that must not. This is where leaks are caught. */
  mustNotContain?: string[]
  /** The answer must cite at least one source as [n]. */
  mustCite?: boolean
  /**
   * The agent must decline rather than answer. Checked against the configured
   * fallback and the classifier's refusal, not by guessing at wording.
   */
  mustRefuse?: boolean
  /** The named action must have run. */
  mustCallAction?: string
  /** Retrieval must return this document id in its top results. */
  mustRetrieve?: string[]
  /** Retrieval must not. For the poisoned-chunk cases. */
  mustNotRetrieve?: string[]

  /**
   * Send this case's question through a corpus that has a hostile passage
   * planted in it. Named so several cases can share one poisoned fixture.
   */
  corpus?: string

  /** Why this case exists. Printed on failure, so a red line explains itself. */
  note?: string
  /**
   * Marks a case whose current result is a known failure. It still runs and is
   * still reported; it just does not fail the suite. Recording a failure is
   * more honest than deleting the case that produces it.
   */
  known?: string
}

export interface CaseResult {
  case: EvalCase
  passed: boolean
  /** One line per check that failed. Empty when it passed. */
  failures: string[]
  answer: string
  cited: number
  actions: string[]
  retrieved: string[]
  ms: number
}

/**
 * Reads a JSONL suite.
 *
 * JSONL rather than JSON because a suite is appended to constantly, and a
 * one-line diff is far easier to review than a reformatted array.
 */
export function parseSuite(text: string, suite: string): EvalCase[] {
  const cases: EvalCase[] = []

  for (const [position, line] of text.split('\n').entries()) {
    const trimmed = line.trim()
    // Comments are not JSONL, but a suite nobody can annotate is a suite
    // nobody maintains.
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue

    let parsed: EvalCase
    try {
      parsed = JSON.parse(trimmed) as EvalCase
    } catch (error) {
      throw new Error(
        `${suite}:${position + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!parsed.id) throw new Error(`${suite}:${position + 1} has no id`)
    if (!parsed.question && !parsed.mustRetrieve) {
      throw new Error(`${suite}:${position + 1} (${parsed.id}) has no question`)
    }

    cases.push({ ...parsed, suite: parsed.suite ?? suite })
  }

  const ids = new Set<string>()
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`${suite} has two cases with id "${item.id}"`)
    ids.add(item.id)
  }

  return cases
}
