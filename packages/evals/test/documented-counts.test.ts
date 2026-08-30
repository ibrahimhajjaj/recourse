import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSuite } from '../src/case.js'

/**
 * A case count written into prose goes stale the first time somebody adds a
 * case, and nothing anywhere reports it. The docs said 146 for a suite that
 * held 100, which reads as authority and is worth less than no number at all.
 */

const DOCS = join(import.meta.dirname, '../../../docs')
const SUITES = join(import.meta.dirname, '../suites')

function total(): number {
  return readdirSync(SUITES)
    .filter((file) => file.endsWith('.jsonl'))
    .reduce(
      (sum, file) =>
        sum + parseSuite(readFileSync(join(SUITES, file), 'utf8'), file).length,
      0,
    )
}

describe('numbers the documentation states about the suites', () => {
  it('counts the cases the way the harness does', () => {
    const counted = total()
    // Guards the guard: a counter that returned zero would agree with prose
    // claiming zero, and pass for the wrong reason forever.
    expect(counted).toBeGreaterThan(50)

    for (const page of ['evals.md', 'models.md']) {
      const text = readFileSync(join(DOCS, page), 'utf8')
      for (const [claim, stated] of text.matchAll(/(\d+) cases (?:across|including)/g)) {
        // The dated snapshot in models.md is deliberately not restated, so
        // only a claim about the suites as they stand now has to match.
        if (/as those suites stood that day/.test(text.slice(text.indexOf(claim), text.indexOf(claim) + 200))) continue
        expect(Number(stated), `${page}: "${claim}"`).toBe(counted)
      }
    }
  })
})
