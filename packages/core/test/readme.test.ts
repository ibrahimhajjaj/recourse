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
