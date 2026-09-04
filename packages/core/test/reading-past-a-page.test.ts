import { describe, expect, it } from 'vitest'
import { memoryStore } from '../src/store/index.js'
import { outcomes } from '../src/outcomes.js'
import { summariseStale, INSIGHT_KEYS } from '../src/insights.js'
import { MockLanguageModelV4 } from 'ai/test'
import type { Store } from '../src/store/types.js'

/**
 * A page is capped well below what these callers ask for, and asking for more
 * than the cap is silently honoured as the cap. Every instance of that is a
 * confident wrong number rather than an error.
 */

async function conversations(store: Store, count: number, over: (index: number) => Record<string, unknown> = () => ({})) {
  for (let index = 0; index < count; index++) {
    const at = new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString()
    await store.appendMessage(
      `c${index}`,
      { id: `m${index}`, role: 'user', content: 'where is my order', createdAt: at },
      { channel: 'web', meta: over(index) },
    )
    await store.appendMessage(`c${index}`, {
      id: `a${index}`,
      role: 'assistant',
      content: 'It is on its way.',
      createdAt: at,
    })
  }
}

describe('a report asked to look at more than one page', () => {
  it('looks at what it was asked for', async () => {
    // It used to answer with two hundred and report it as five hundred's
    // worth, which reads as an answer and is a fifth of one.
    const store = memoryStore()
    await conversations(store, 300)

    expect((await outcomes({ store, limit: 300 })).conversations).toBe(300)
  })

  it('stops at the limit rather than reading everything', async () => {
    const store = memoryStore()
    await conversations(store, 300)

    expect((await outcomes({ store, limit: 50 })).conversations).toBe(50)
  })
})

describe('an insight that has gone stale on a quiet conversation', () => {
  /** Answers in the three lines the summariser parses. */
  const model = new MockLanguageModelV4({
    doGenerate: async () =>
      ({
        content: [{ type: 'text', text: 'TITLE: Where is my order\nSUMMARY: They asked.\nMOOD: neutral' }],
        finishReason: 'stop',
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }) as never,
  })

  it('is found however far down the list it has sunk', async () => {
    // Newest first, so one nobody has touched for a month sat behind hundreds
    // of fresher ones and was never refreshed. Reading a page and filtering it
    // finds nothing at all here.
    const store = memoryStore()
    await conversations(store, 300, (index) => (index === 0 ? { [INSIGHT_KEYS.stale]: true } : {}))

    expect(await summariseStale({ store, model, limit: 5 })).toMatchObject({ done: 1, failed: 0 })
  })

  it('does nothing when none are marked', async () => {
    const store = memoryStore()
    await conversations(store, 10)

    expect(await summariseStale({ store, model, limit: 5 })).toMatchObject({ done: 0 })
  })
})
