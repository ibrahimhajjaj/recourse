import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../src/safety/types.js'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const docs = join(repo, 'docs')
const skills = join(repo, 'skills')

/**
 * Every page that shows somebody how to import this, the skill included.
 *
 * The skill file was outside this check for a while, which meant the one
 * document an agent reads and follows verbatim was the one document nothing
 * verified.
 */
const pages = [
  join(repo, 'README.md'),
  ...(existsSync(docs) ? readdirSync(docs).filter((f) => f.endsWith('.md')).map((f) => join(docs, f)) : []),
  ...(existsSync(skills)
    ? readdirSync(skills)
        .map((name) => join(skills, name, 'SKILL.md'))
        .filter((path) => existsSync(path))
    : []),
  // Each package's own README, which is the page npm renders. That one was
  // outside this check while it was the most public of the lot.
  ...readdirSync(join(here, '..', '..'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(here, '..', '..', entry.name, 'README.md'))
    .filter((path) => existsSync(path)),
]

const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  name: string
  exports: Record<string, unknown>
}

// Taken from the manifest rather than written out, so a rename shows up as the
// examples failing to match anything real instead of as this file quietly
// looking for a name nothing uses any more.
const self = pkg.name
const selfPattern = self.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Every sibling package, by the name it publishes under.
 *
 * The docs import from the store adapters as well as from here, and those
 * lines went unchecked: `pgVectorStore` could have been renamed and the only
 * place it showed up would be somebody pasting a documented import that throws.
 */
function siblings(): Map<string, string> {
  const packages = join(here, '..', '..')
  const found = new Map<string, string>()

  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const manifest = join(packages, entry.name, 'package.json')
    const src = join(packages, entry.name, 'src')
    if (!existsSync(manifest) || !existsSync(src)) continue

    const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
    if (name && name !== self) found.set(name, src)
  }

  return found
}

/** Everything the source makes available under any name. */
function exportedNames(from: string = join(here, '..', 'src')): Set<string> {
  const found = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(path, 'utf8')
        for (const m of source.matchAll(
          /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
        )) {
          found.add(m[1] as string)
        }
        // Re-exports, which is how most of the barrels expose things.
        for (const m of source.matchAll(/export\s*\{([^}]+)\}/g)) {
          for (const part of (m[1] as string).split(',')) {
            const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()
            if (name) found.add(name.trim())
          }
        }
      }
    }
  }
  walk(from)
  return found
}

/**
 * A documented import that does not exist is worse than no example, because it
 * is followed rather than questioned. One of these shipped: an example told
 * readers to import `deliverWebhook`, which was never a thing. Nothing catches
 * that, since a markdown file is not compiled.
 */
describe('the examples in the documentation', () => {
  const available = exportedNames()

  const imports = pages.flatMap((page) => {
    const text = readFileSync(page, 'utf8')
    const from = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*'(${selfPattern}[^']*)'`, 'g')

    return [...text.matchAll(from)].flatMap((m) =>
      (m[1] as string)
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0 && !name.startsWith('type '))
        .map((name) => ({ page: page.replace(repo, '').replace(/^\//, ''), name, entry: m[2] as string })),
    )
  })

  it('import from entry points the package really has', () => {
    const wrong = imports
      .filter(({ entry }) => {
        const key = entry === self ? '.' : `./${entry.slice(self.length + 1)}`
        return !(key in pkg.exports)
      })
      .map(({ page, entry }) => `${page}: ${entry}`)

    expect([...new Set(wrong)], 'documented entry points that do not exist').toEqual([])
  })

  it('import names the source actually exports', () => {
    const invented = imports
      .filter(({ name }) => !available.has(name))
      .map(({ page, name, entry }) => `${page}: ${name} from ${entry}`)

    expect(invented, 'documented imports that are not exported').toEqual([])
  })

  // An example that cannot be pasted is an example somebody has to guess at,
  // and the thing they guess at is which of fifteen entry points it came from.
  it('show where a function comes from before calling it', () => {
    const uncopyable: string[] = []

    for (const page of pages) {
      const text = readFileSync(page, 'utf8')
      const imported = new Set<string>()

      for (const block of text.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)) {
        const body = block[1] as string

        for (const m of body.matchAll(/import\s*\{([^}]+)\}/g)) {
          for (const name of (m[1] as string).split(',')) imported.add(name.trim())
        }

        for (const call of body.matchAll(/\b([a-z][A-Za-z0-9]*)\s*\(/g)) {
          const name = call[1] as string
          if (available.has(name) && !imported.has(name)) {
            uncopyable.push(`${page.replace(repo, '').replace(/^\//, '')}: ${name}`)
          }
        }
      }
    }

    expect([...new Set(uncopyable)], 'called without ever being imported on that page').toEqual([])
  })

  // The model table claimed 20/20 on injection while its own total said 68/69,
  // and 27 + 20 + 22 is 69. Nobody adds up a table they are reading for the
  // headline, so it went unnoticed against a recorded run that said 19/20.
  it('report scores that add up', () => {
    const page = join(docs, 'models.md')
    if (!existsSync(page)) return

    // The same page carries a vision and tools table with the same shape and
    // no scores in it, so rows are picked by having a total rather than by
    // looking like a model row.
    const rows = readFileSync(page, 'utf8')
      .split('\n')
      .filter((line) => /^\| `[^`]+` \|[^|]*\| \*?\*?\d+\/\d+/.test(line))

    expect(rows.length, 'no scored rows found, so this is checking nothing').toBeGreaterThan(0)

    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((cell) => cell.trim().replace(/\*\*/g, ''))
      const [model, , total, ...rest] = cells
      const parts = rest.filter((cell) => /^\d+\/\d+$/.test(cell))

      const scored = parts.reduce((sum, cell) => sum + Number(cell.split('/')[0]), 0)
      const possible = parts.reduce((sum, cell) => sum + Number(cell.split('/')[1]), 0)

      expect(`${model} ${total}`).toBe(`${model} ${scored}/${possible}`)
    }
  })

  // The shipped policy is the one thing a reader cannot check by running
  // anything: a category that refuses and a category that only records look
  // identical until something goes wrong. So the page listing them is held to
  // the list itself.
  it('describe every category that ships, and what it actually does', () => {
    const safety = readFileSync(join(docs, 'safety.md'), 'utf8')
    const verb: Record<string, string> = {
      refuse: 'refuses',
      handoff: 'hands off',
      flag: 'flags',
      deflect: 'deflects',
      allow: 'allows',
    }

    expect(DEFAULT_CATEGORIES.length).toBeGreaterThan(3)

    for (const category of DEFAULT_CATEGORIES) {
      const line = safety
        .split('\n')
        .find((row) => row.includes(`\`${category.name}\``) && row.trimStart().startsWith('-'))

      expect(line, `safety.md never lists the ${category.name} category`).toBeTruthy()
      expect(line, `safety.md is wrong about what ${category.name} does`).toContain(
        verb[category.action],
      )
    }
  })

  it('are worth having at all', () => {
    // If this ever reads zero, the extraction above has quietly stopped
    // matching and the two checks are passing on an empty list.
    expect(imports.length).toBeGreaterThan(10)
  })
})

describe('the examples that import from the other packages', () => {
  const others = siblings()

  // `import { x } from '@scope/pkg'`, for any sibling rather than this one.
  const imports = pages.flatMap((page) => {
    const text = readFileSync(page, 'utf8')

    return [...text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(@[\w-]+\/[\w-]+)'/g)]
      .filter((m) => others.has(m[2] as string))
      .flatMap((m) =>
        (m[1] as string)
          .split(',')
          .map((name) => name.trim().replace(/^type\s+/, ''))
          .filter(Boolean)
          .map((name) => ({ page: page.replace(repo, '').replace(/^\//, ''), name, from: m[2] as string })),
      )
  })

  it('name something those packages really export', () => {
    // Verified by hand once: the docs tell people to import `postgresStore`,
    // `pgVectorStore` and `d1Store`. Nothing was checking that they still exist.
    const invented = imports
      .filter(({ name, from }) => !exportedNames(others.get(from) as string).has(name))
      .map(({ page, name, from }) => `${page}: ${name} from ${from}`)

    expect(invented, 'documented imports the sibling package does not export').toEqual([])
  })

  it('checks the adapters at all, rather than passing on an empty list', () => {
    expect(imports.length).toBeGreaterThan(0)
  })
})

describe('the entry points the prose names', () => {
  /** The subpaths this package publishes, from the manifest. */
  const subpaths = Object.keys(pkg.exports)
    .filter((key) => key.startsWith('./') && key !== './package.json')
    .map((key) => key.slice(2))

  it('spells them the way somebody would have to type them', () => {
    // The rename swept import statements and missed the prose. A table in the
    // published README listed every entry point under the old bare name, so
    // the npm page told people to import something that does not exist.
    const stale: string[] = []

    for (const page of pages) {
      const text = readFileSync(page, 'utf8')

      for (const m of text.matchAll(/`([\w@/-]+)\/([\w-]+)`/g)) {
        const [, scope, tail] = m as unknown as [string, string, string]
        if (subpaths.includes(tail) && !`${scope}/${tail}`.startsWith(self)) {
          stale.push(`${page.replace(repo, '').replace(/^\//, '')}: ${scope}/${tail}`)
        }
      }
    }

    expect([...new Set(stale)], 'entry points named under a package that is not this one').toEqual([])
  })

  it('found some entry points to check, rather than an empty list', () => {
    expect(subpaths.length).toBeGreaterThan(10)
  })
})

describe('the skill, as the installer has to find it', () => {
  // `skills add <owner>/<repo>` walks `skills/` looking for directories that
  // contain a SKILL.md, and reads two frontmatter fields off each. Get the
  // layout or either field wrong and the skill is simply not there, with no
  // error to explain why.
  const container = join(repo, 'skills')
  const found = existsSync(container)
    ? readdirSync(container, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, file: join(container, entry.name, 'SKILL.md') }))
        .filter((entry) => existsSync(entry.file))
    : []

  it('ships at least one skill in the layout the installer walks', () => {
    expect(found.length).toBeGreaterThan(0)
  })

  it('carries the two fields the installer requires', () => {
    for (const { name, file } of found) {
      const front = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, 'utf8'))
      expect(front, `${name} has no frontmatter block`).not.toBeNull()

      const fields = Object.fromEntries(
        (front?.[1] ?? '')
          .split('\n')
          .filter((line) => /^[a-z]/.test(line) && line.includes(':'))
          .map((line) => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]),
      )

      expect(fields.name, `${name} declares no name`).toBeTruthy()
      expect(fields.description, `${name} declares no description`).toBeTruthy()

      // The directory is what somebody types; a name that disagrees with it
      // installs one thing under another thing's label.
      expect(fields.name, `${name} declares a different name`).toBe(name)
      expect(fields.name, `${name} is not a usable identifier`).toMatch(/^[a-z0-9-]+$/)
    }
  })
})
