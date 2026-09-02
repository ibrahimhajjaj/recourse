import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The plugin's test count, written in two documents, checked against the suite.
 *
 * A count in prose goes stale the moment somebody adds a test, and nothing
 * reports it. This one already did: both pages were corrected to 86 and were
 * wrong again the same day, because a parity suite landed in between. The
 * number is worth stating, so it is worth holding to.
 *
 * Method counts only, not assertions. A method is countable from the source;
 * an assertion count needs a run, and a test that shells out to phpunit would
 * make the Node suite depend on a PHP toolchain nobody installs to change a
 * TypeScript file.
 */

const ROOT = join(import.meta.dirname, '../../..')
const TESTS = join(ROOT, 'packages/wordpress/tests')

function methods(): number {
  return readdirSync(TESTS)
    .filter((file) => file.endsWith('Test.php'))
    .reduce(
      (sum, file) => sum + (readFileSync(join(TESTS, file), 'utf8').match(/^\s*public function test/gm) ?? []).length,
      0,
    )
}

describe('the plugin test count the documentation states', () => {
  it('matches the methods the suite actually declares', () => {
    const counted = methods()
    // Guards the guard: a counter returning zero would agree with prose
    // claiming zero and pass for the wrong reason for ever.
    expect(counted).toBeGreaterThan(50)

    for (const page of ['packages/wordpress/README.md', 'docs/wordpress.md']) {
      const text = readFileSync(join(ROOT, page), 'utf8')
      for (const [claim, stated] of text.matchAll(/(\d+) tests, \d+ assertions/g)) {
        expect(Number(stated), `${page}: "${claim}"`).toBe(counted)
      }
    }
  })
})

describe('the channel count the documentation states', () => {
  it('matches the rows in the channel table', () => {
    const table = readFileSync(join(ROOT, 'docs/channels.md'), 'utf8')
    // Rows between the header separator and the blank line after it, which is
    // the list a reader is actually counting when they read the number.
    const after = table.slice(table.indexOf('| --- |')).split('\n').slice(1)
    const end = after.findIndex((line) => !line.startsWith('|'))
    const rows = (end === -1 ? after : after.slice(0, end)).length

    expect(rows).toBeGreaterThan(5)

    const words: Record<number, string> = { 11: 'Eleven', 12: 'Twelve', 13: 'Thirteen', 14: 'Fourteen' }
    for (const page of ['packages/wordpress/README.md', 'docs/wordpress.md']) {
      const text = readFileSync(join(ROOT, page), 'utf8')
      const stated = text.match(/(Eleven|Twelve|Thirteen|Fourteen) channels/)
      expect(stated?.[1], `${page} states a channel count`).toBe(words[rows])
    }
  })
})
