import { describe, expect, it } from 'vitest'
import { storeConformance, message, type SuiteHooks } from '../src/store/conformance.js'
import { memoryStore } from '../src/store/memory.js'
import type { Store } from '../src/store/types.js'

/**
 * Runs the suite against a store and reports what happened, without needing a
 * runner inside a runner. `it` bodies are collected and awaited by hand, so a
 * conformance failure here is a returned value rather than a failed test.
 */
async function runSuite(store: () => Store, supports?: Parameters<typeof storeConformance>[0]['supports']) {
  const names: string[] = []
  const failures: Array<{ name: string; why: string }> = []
  const bodies: Array<{ name: string; body: () => unknown }> = []

  const hooks: SuiteHooks = {
    describe: (_name, body) => body(),
    it: (name, body) => {
      names.push(name)
      bodies.push({ name, body })
    },
  }

  storeConformance({ name: 'under test', make: store, hooks, ...(supports ? { supports } : {}) })

  for (const { name, body } of bodies) {
    try {
      await body()
    } catch (error) {
      failures.push({ name, why: error instanceof Error ? error.message : String(error) })
    }
  }

  return { names, failures }
}

describe('the conformance suite itself', () => {
  it('passes a store that does everything', async () => {
    const { names, failures } = await runSuite(() => memoryStore())

    expect(failures).toEqual([])
    expect(names.length).toBeGreaterThan(15)
  })

  it('skips the tests a store says it does not support', async () => {
    const { names } = await runSuite(() => memoryStore(), { stats: false, leads: false })

    expect(names.some((name) => name.includes('numbers a support lead'))).toBe(false)
    expect(names.some((name) => name.includes('leads newest first'))).toBe(false)
    // Everything else still runs.
    expect(names.some((name) => name.includes('creates the conversation'))).toBe(true)
  })

  it('says out loud what a store opted out of', async () => {
    const { names } = await runSuite(() => memoryStore(), { deletes: false })

    // A green tick on a suite that quietly skipped half of itself tells the
    // reader nothing, so the opt-out is a test of its own.
    expect(names.some((name) => name === 'declares it does not support: deletes')).toBe(true)
  })

  it('catches a store that drops conversation metadata', async () => {
    const broken: Store = { ...memoryStore(), async updateConversation() {} }
    const { failures } = await runSuite(() => broken)

    // The exact defect that would have an agent talking over a human.
    expect(failures.some((failure) => failure.name.includes('metadata put on a conversation'))).toBe(true)
  })

  it('catches a store that only pretends to forget somebody', async () => {
    const real = memoryStore()
    const pretending: Store = { ...real, async deleteConversation() { return true } }
    const { failures } = await runSuite(() => pretending)

    expect(failures.some((failure) => failure.name.includes('forgets a conversation'))).toBe(true)
  })

  it('reports what was compared when something fails', async () => {
    const wrong: Store = {
      ...memoryStore(),
      async getConversation() {
        return null
      },
    }
    const { failures } = await runSuite(() => wrong)

    expect(failures.length).toBeGreaterThan(0)
    expect(failures[0]?.why).toContain('store conformance:')
  })

  it('explains itself when no runner is in scope', () => {
    // The default path reads describe/it off globalThis, which this repo's
    // vitest does not provide. The message has to name the way out.
    expect(() => storeConformance({ name: 'x', make: () => memoryStore() })).toThrow(/describe\/it|hooks/)
  })

  it('builds a usable message fixture', () => {
    const built = message({ content: 'hello there' })
    expect(built.role).toBe('user')
    expect(built.content).toBe('hello there')
    expect(built.id.startsWith('m_')).toBe(true)
  })
})
