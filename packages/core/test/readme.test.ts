import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string
  exports: Record<string, unknown>
}

// Read off the manifest, not written out. This file used to spell the entry
// points under the package's old bare name, so it held the README to a name
// nothing published under and the table stayed wrong while the test was green.
const self = pkg.name
const selfPattern = self.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const readme = readFileSync(join(root, 'README.md'), 'utf8')

/**
 * The exports table is the first thing anybody installing this reads, and it
 * had drifted: two entry points existed with no row, and one row described
 * seven channels when there were ten. Nothing catches that, because a README is
 * not compiled and a wrong one still passes every other test.
 */
describe('the exports table', () => {
  const rows = new RegExp(`\\| \`(${selfPattern}[^\`]*)\``, 'g')
  const documented = new Set([...readme.matchAll(rows)].map((m) => m[1] as string))

  const exported = new Set(
    Object.keys(pkg.exports)
      .filter((key) => key !== './package.json')
      .map((key) => (key === '.' ? self : key.replace('./', `${self}/`))),
  )

  it('has a row for every entry point the package actually exports', () => {
    const missing = [...exported].filter((entry) => !documented.has(entry))
    expect(missing, 'entry points with no row in the README').toEqual([])
  })

  it('does not promise an entry point that does not exist', () => {
    const invented = [...documented].filter((entry) => !exported.has(entry))
    expect(invented, 'rows in the README for entry points that are not exported').toEqual([])
  })
})

/**
 * The refusal codes exist so a client can react to one and not another without
 * matching on prose. A code nobody documented is a code nobody can react to,
 * and a table is not compiled: it stays wrong while every other test is green.
 */
describe('the chat endpoint refusal codes', () => {
  const handler = readFileSync(join(root, 'src/server/handler.ts'), 'utf8')
  const security = readFileSync(join(root, '../../docs/security.md'), 'utf8')

  const used = new Set([...handler.matchAll(/code: '([a-z_]+)'/g)].map((match) => match[1] as string))

  // Rows of the table, not anywhere in the page. `rate_limited` is also one of
  // the words the provider-failure log uses, so a looser search finds it there
  // and passes while the table is missing it.
  const table = new Set([...security.matchAll(/^\| `([a-z_]+)` \| \d{3} \|/gm)].map((match) => match[1] as string))

  it('are every one of them in the table', () => {
    expect(table.size).toBeGreaterThan(0)
    const missing = [...used].filter((code) => !table.has(code))
    expect(missing, `refusal codes the endpoint sends but the table never lists: ${missing}`).toEqual([])
  })

  it('are documented for codes that actually exist', () => {
    const invented = [...table].filter((code) => !used.has(code))
    expect(invented, `codes in the table the endpoint never sends: ${invented}`).toEqual([])
  })
})

/**
 * A store can opt out of parts of the conformance suite, and the list of what
 * it may opt out of is a promise to whoever is writing one. A capability added
 * to the type and not to the page is a promise nobody knows they have.
 */
describe('the store capabilities', () => {
  const conformance = readFileSync(join(root, 'src/store/conformance.ts'), 'utf8')
  const stores = readFileSync(join(root, '../../docs/stores.md'), 'utf8')

  const declared = [...conformance.matchAll(/^ {2}([a-zA-Z]+)\?: boolean$/gm)].map((match) => match[1] as string)

  it('are every one of them on the page that promises them', () => {
    expect(declared.length).toBeGreaterThan(0)

    const missing = declared.filter((capability) => !stores.includes(`\`${capability}\``))
    expect(missing, `capabilities a store may decline that docs/stores.md never lists: ${missing}`).toEqual([])
  })
})

/**
 * Counts written into prose go stale the first time somebody adds one, and
 * nothing anywhere reports it. The evals suite already guards its own case
 * counts for exactly this reason; these are the other two the docs state.
 */
describe('counts the documentation states', () => {
  const WORDS: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  }

  it('says how many inline components ship', () => {
    const ui = readFileSync(join(root, '../widget/src/ui.ts'), 'utf8')
    const listed = /RENDERERS: Record<string, UiRenderer> = \{([^}]*)\}/.exec(ui)?.[1] ?? ''
    const kinds = listed.split(',').map((name) => name.trim()).filter(Boolean)

    expect(kinds.length).toBeGreaterThan(0)

    const actions = readFileSync(join(root, '../../docs/actions.md'), 'utf8')
    const claim = /^(\w+) kinds ship: (.+?), plus forms/ms.exec(actions)

    expect(claim, 'docs/actions.md no longer says how many kinds ship').not.toBeNull()
    expect(WORDS[(claim?.[1] ?? '').toLowerCase()], `docs/actions.md says "${claim?.[1]} kinds"`).toBe(kinds.length)

    for (const kind of kinds) {
      expect(claim?.[2], `docs/actions.md never names the "${kind}" component`).toContain(`\`${kind}\``)
    }
  })

  it('says how many knowledge sources ship', () => {
    const index = readFileSync(join(root, 'src/sources/index.ts'), 'utf8')
    const sources = [...index.matchAll(/export \{[^}]*?\b(\w+Source)\b/gs)].map((match) => match[1] as string)
    const unique = new Set(sources)

    expect(unique.size).toBeGreaterThan(0)

    const retrieval = readFileSync(join(root, '../../docs/retrieval.md'), 'utf8')
    const claim = /A website and a folder are two of (\w+)\./.exec(retrieval)

    expect(claim, 'docs/retrieval.md no longer says how many sources there are').not.toBeNull()
    expect(WORDS[(claim?.[1] ?? '').toLowerCase()], `docs/retrieval.md says "two of ${claim?.[1]}"`).toBe(unique.size)
  })
})
