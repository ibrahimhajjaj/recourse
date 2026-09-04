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
