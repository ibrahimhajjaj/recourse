import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')

/**
 * Exported so something else can reach it, not because anybody calls it.
 *
 * The rule for being on this list is that a reader would never type the name:
 * either the door is an option somewhere else (`classifier:` rather than
 * `createClassifier`, `rateLimit:` rather than `createRateLimiter`, `mcp:`
 * rather than `createMcp`), or it is a part the voice stack assembles for you.
 *
 * Adding a name here to make this test pass is the failure it exists to catch.
 * If somebody is meant to call it, write the two lines in the documentation
 * instead.
 */
const INTERNAL = new Set([
  'createClassifier',
  'createEmbedder',
  'createKnowledgeSearch',
  'createMcp',
  'createRateLimiter',
  'createRouter',
  'createCallSession',
  'createSentenceBuffer',
  'createSpeechCache',
  'createTurnDetector',
  'memoryLedger',
  'indexVectorStore',
  'validateSource',
])

/** The shapes a reader is meant to call: factories, sources, adapters. */
const userFacing = (name: string) =>
  /^create[A-Z]/.test(name) ||
  /Source$/.test(name) ||
  /Action$/.test(name) ||
  /Blobs$/.test(name) ||
  /Store$/.test(name) ||
  /Voice$|Transcriber$/.test(name)

describe('every feature somebody could use is written down', () => {
  it('names no capability the documentation never mentions', async () => {
    const dist = join(here, '..', 'dist', 'index.js')
    if (!existsSync(dist)) return

    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      exports: Record<string, string | { import?: string }>
    }

    const docs = execSync('git ls-files "*.md"', { cwd: repo })
      .toString()
      .trim()
      .split('\n')
      .map((file) => readFileSync(join(repo, file), 'utf8'))
      .join('\n')

    const buried: string[] = []

    for (const [entry, target] of Object.entries(pkg.exports)) {
      const file = typeof target === 'string' ? target : target.import
      if (!file || file.endsWith('.json')) continue

      let loaded: Record<string, unknown>
      try {
        loaded = (await import(join(here, '..', file))) as Record<string, unknown>
      } catch {
        continue
      }

      for (const name of Object.keys(loaded)) {
        if (name === 'default' || INTERNAL.has(name) || !userFacing(name)) continue
        // A whole word. Otherwise a page mentioning `textSourceOptions`
        // would count as documenting `textSource`, which is how a burial
        // hides behind a near-miss.
        if (!new RegExp(`\\b${name}\\b`).test(docs)) buried.push(`${entry}: ${name}`)
      }
    }

    // The failure this catches is quiet and specific: a capability that works,
    // is exported, and that nobody outside this repository can discover. Four
    // were found the first time it ran, including `defineAction`, which is how
    // you write an action that is not an HTTP call.
    expect([...new Set(buried)], 'exported, works, and documented nowhere').toEqual([])
  })
})
