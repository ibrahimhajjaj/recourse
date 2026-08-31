import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { createAgent } from '../src/agent.js'
import { costOf, createBudget, memoryLedger, redisLedger, PRICES, PRICES_CHECKED } from '../src/budget.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [
      textSource([
        {
          id: 'refunds',
          title: 'Refunds',
          url: 'https://shop.example/refunds',
          text: '# Refunds\n\nWe refund any order within 30 days of delivery.',
        },
      ]),
    ],
  })
  return cached
}

/**
 * Token counts as a provider actually reports them.
 *
 * Nested, because the provider protocol splits cached from uncached input and
 * reasoning from text output. The flat `inputTokens: number` shape is what the
 * SDK hands back afterwards, and a mock built to that shape reports nothing at
 * all, which makes a metering test pass while metering nothing.
 */
function used(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  }
}

function speaking(text = 'Thirty days [1].', usage = used(1000, 500)) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: '0' },
          { type: 'text-delta' as const, id: '0', delta: text },
          { type: 'text-end' as const, id: '0' },
          { type: 'finish' as const, finishReason: { unified: 'stop', raw: 'stop' } as const, usage },
        ],
        chunkDelayInMs: 0,
      }),
    }),
  })
}

describe('pricing a call', () => {
  it('charges input and output at their own rates', () => {
    const cost = costOf('openai/gpt-4o-mini', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(cost).toBeCloseTo(PRICES['openai/gpt-4o-mini']!.input + PRICES['openai/gpt-4o-mini']!.output, 10)
  })

  it('prices a bare model id the same as a prefixed one', () => {
    expect(costOf('gpt-4o-mini', { inputTokens: 2_000_000, outputTokens: 0 })).toBeCloseTo(0.3, 10)
  })

  it('reports an unknown model rather than valuing it at zero', () => {
    expect(costOf('qwen3:4b', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeUndefined()
  })

  it('counts a missing half as zero rather than as NaN', () => {
    expect(costOf('openai/gpt-4o-mini', { inputTokens: 1_000_000 })).toBeCloseTo(0.15, 10)
  })

  it('prices the dated snapshot a provider actually served', () => {
    // A request for gpt-4o comes back as gpt-4o-2024-11-20. Matching only
    // exactly would price every real response as unknown.
    expect(costOf('openai/gpt-4o-2024-11-20', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(2.5, 10)
    expect(costOf('gpt-4o-mini-2024-07-18', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.15, 10)
    expect(costOf('claude-haiku-4.5-20260101', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(1, 10)
  })

  it('does not mistake a different model for a dated one', () => {
    // Stripping a suffix must never reach across to another model's price.
    expect(costOf('openai/gpt-4o-mini-audio', { inputTokens: 1_000_000, outputTokens: 0 })).toBeUndefined()
  })

  it('tells a declared-free model apart from one with no price at all', () => {
    const free = { 'ollama/qwen3:4b': { input: 0, output: 0 } }
    expect(costOf('ollama/qwen3:4b', { inputTokens: 5_000_000, outputTokens: 5_000_000 }, free)).toBe(0)
    expect(costOf('ollama/mistral', { inputTokens: 5_000_000, outputTokens: 5_000_000 }, free)).toBeUndefined()
  })

  it('prices a whole family from one entry', () => {
    // Somebody self-hosting has a handful of models and swaps them. Naming
    // each one is a list that is wrong the first time they pull a new tag.
    const free = { 'ollama/*': { input: 0, output: 0 } }
    for (const model of ['ollama/qwen3:4b', 'ollama/gemma4:12b-it-qat', 'ollama/granite4.1:8b', 'ollama/moondream']) {
      expect(costOf(model, { inputTokens: 9_000_000, outputTokens: 9_000_000 }, free)).toBe(0)
    }
    // And it does not reach past its own prefix.
    expect(costOf('openai/gpt-4o', { inputTokens: 1, outputTokens: 1 }, free)).toBeUndefined()
  })

  it('lets a specific price beat the family it sits in', () => {
    const mixed = {
      'together/*': { input: 1, output: 1 },
      'together/llama-70b': { input: 9, output: 9 },
    }
    expect(costOf('together/llama-70b', { inputTokens: 1_000_000, outputTokens: 0 }, mixed)).toBeCloseTo(9, 10)
    expect(costOf('together/llama-8b', { inputTokens: 1_000_000, outputTokens: 0 }, mixed)).toBeCloseTo(1, 10)
  })

  it('takes the longest matching pattern', () => {
    const nested = {
      '*': { input: 1, output: 1 },
      'ollama/*': { input: 2, output: 2 },
      'ollama/qwen*': { input: 3, output: 3 },
    }
    expect(costOf('ollama/qwen3:4b', { inputTokens: 1_000_000, outputTokens: 0 }, nested)).toBeCloseTo(3, 10)
    expect(costOf('ollama/mistral', { inputTokens: 1_000_000, outputTokens: 0 }, nested)).toBeCloseTo(2, 10)
    expect(costOf('anything-else', { inputTokens: 1_000_000, outputTokens: 0 }, nested)).toBeCloseTo(1, 10)
  })
})

describe('the id a model prices under', () => {
  it('puts the provider back on a self-hosted model', async () => {
    const { models } = await import('../src/models.js')
    const local = models.local('qwen3:4b') as { modelId: string; provider: string }

    // The SDK reports a bare `qwen3:4b`, which says nothing about who served
    // it. Without the provider, `ollama/*` could never match anything.
    expect(local.modelId).toBe('qwen3:4b')
    expect(local.provider.split('.')[0]).toBe('ollama')
  })
})

describe('caps', () => {
  it('lets everything through when nothing is capped', async () => {
    const budget = createBudget()
    await budget.record('openai/gpt-4o', { inputTokens: 10_000_000, outputTokens: 10_000_000 })
    expect((await budget.check()).ok).toBe(true)
  })

  it('stops the next turn once the daily token cap is reached', async () => {
    const budget = createBudget({ dailyTokens: 1000 })

    expect((await budget.check()).ok).toBe(true)
    await budget.record('openai/gpt-4o-mini', { inputTokens: 600, outputTokens: 500 })

    const verdict = await budget.check()
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('daily token cap')
    expect(verdict.message).toContain('person')
  })

  it('counts dollars separately from tokens', async () => {
    // A tenth of a cent, well under any token cap, but over this dollar one.
    const budget = createBudget({ dailyUsd: 0.0001, dailyTokens: 1_000_000_000 })
    await budget.record('openai/gpt-4o', { inputTokens: 1000, outputTokens: 1000 })

    const verdict = await budget.check()
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('daily spend cap')
  })

  it('warns instead of stopping when told to', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const budget = createBudget({ dailyTokens: 10, onExceeded: 'warn' })
    await budget.record('openai/gpt-4o-mini', { inputTokens: 100, outputTokens: 0 })

    expect((await budget.check()).ok).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('daily token cap'))
    warn.mockRestore()
  })

  it('rolls over at midnight without touching the month', async () => {
    let today = '2026-08-31T12:00:00.000Z'
    const budget = createBudget({ dailyTokens: 100, monthlyTokens: 1000, now: () => new Date(today) })

    await budget.record('openai/gpt-4o-mini', { inputTokens: 150, outputTokens: 0 })
    expect((await budget.check()).ok).toBe(false)

    today = '2026-09-01T12:00:00.000Z'
    expect((await budget.check()).ok).toBe(true)

    // The month rolled too, so its total started again as well.
    expect((await budget.spent()).month.tokens).toBe(0)
  })

  it('keeps counting tokens for a model it cannot price', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const budget = createBudget({ dailyTokens: 100 })
    await budget.record('qwen3:4b', { inputTokens: 200, outputTokens: 0 })

    expect((await budget.check()).ok).toBe(false)
    expect((await budget.spent()).day.usd).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no price for model'))
    warn.mockRestore()
  })

  it('says so only once per unpriced model', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const budget = createBudget({ dailyTokens: 1_000_000 })

    await budget.record('qwen3:4b', { inputTokens: 1, outputTokens: 1 })
    await budget.record('qwen3:4b', { inputTokens: 1, outputTokens: 1 })

    expect(warn.mock.calls.filter(([line]) => String(line).includes('no price'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('prices a model the caller supplies itself', async () => {
    const budget = createBudget({ prices: { 'qwen3:4b': { input: 1000, output: 1000 } }, dailyUsd: 0.5 })
    await budget.record('qwen3:4b', { inputTokens: 1_000_000, outputTokens: 0 })

    expect((await budget.check()).ok).toBe(false)
  })
})

describe('saying how much of a total is guesswork', () => {
  it('reports the tokens that went unpriced next to the money', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const budget = createBudget({ dailyTokens: 1_000_000_000 })

    await budget.record('openai/gpt-4o-mini', { inputTokens: 1000, outputTokens: 1000 })
    await budget.record('some-local-thing', { inputTokens: 4000, outputTokens: 0 })

    const { day } = await budget.spent()
    expect(day.tokens).toBe(6000)
    expect(day.unpricedTokens).toBe(4000)
    // Two thirds of the volume is not in the dollar figure, and the number
    // that says so sits next to it rather than in a log line.
    expect(day.usd).toBeGreaterThan(0)
    warn.mockRestore()
  })

  it('reports nothing unpriced when everything priced', async () => {
    const budget = createBudget({ dailyTokens: 1_000_000_000 })
    await budget.record('openai/gpt-4o', { inputTokens: 500, outputTokens: 500 })

    expect((await budget.spent()).day.unpricedTokens).toBe(0)
  })

  it('counts a declared-free model as priced, not as guesswork', async () => {
    const budget = createBudget({ dailyTokens: 1_000_000_000, prices: { 'ollama/*': { input: 0, output: 0 } } })
    await budget.record('ollama/qwen3:4b', { inputTokens: 9000, outputTokens: 9000 })

    const { day } = await budget.spent()
    expect(day.tokens).toBe(18_000)
    expect(day.usd).toBe(0)
    // Declared free is a fact. Unknown is an absence. Only one is guesswork.
    expect(day.unpricedTokens).toBe(0)
  })

  it('warns once when a dollar cap rides on a table nobody has checked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    createBudget({ monthlyUsd: 50 })
    const stale = warn.mock.calls.filter(([line]) => String(line).includes('last checked'))

    // The table is current in this build, so this asserts the rule rather than
    // today's answer: it fires only when the table is old, and only in dollars.
    const age = Date.now() - Date.parse(PRICES_CHECKED)
    expect(stale.length).toBe(age > 180 * 86_400_000 ? 1 : 0)

    warn.mockClear()
    createBudget({ monthlyTokens: 50 })
    expect(warn.mock.calls.filter(([line]) => String(line).includes('last checked'))).toHaveLength(0)
    warn.mockRestore()
  })
})

describe('shared ledgers', () => {
  it('reads back what it added', async () => {
    const ledger = memoryLedger()
    await ledger.add('tokens:d:2026-08-31', 40)
    await ledger.add('tokens:d:2026-08-31', 2)
    expect(await ledger.total('tokens:d:2026-08-31')).toBe(42)
    expect(await ledger.total('tokens:d:2026-08-30')).toBe(0)
  })

  it('increments a float in redis and gives day and month different lifetimes', async () => {
    const held = new Map<string, number>()
    const expiries = new Map<string, number>()
    const client = {
      async incrbyfloat(key: string, amount: number) {
        const next = (held.get(key) ?? 0) + amount
        held.set(key, next)
        return String(next)
      },
      async get(key: string) {
        const value = held.get(key)
        return value === undefined ? null : String(value)
      },
      async pexpire(key: string, ms: number) {
        expiries.set(key, ms)
        return 1
      },
    }

    const ledger = redisLedger({ client, prefix: 'test' })
    await ledger.add('usd:d:2026-08-31', 0.25)
    await ledger.add('usd:m:2026-08', 0.25)

    expect(await ledger.total('usd:d:2026-08-31')).toBeCloseTo(0.25, 10)
    expect(expiries.get('test:usd:m:2026-08')).toBeGreaterThan(expiries.get('test:usd:d:2026-08-31') as number)
  })
})

describe('the agent under a budget', () => {
  it('records what the turn used', async () => {
    const budget = createBudget({ dailyTokens: 1_000_000 })
    const agent = createAgent({ index: await index(), model: speaking(), embedder: false, budget })

    await agent.answer('refunds?')
    expect((await budget.spent()).day.tokens).toBe(1500)
  })

  it('does not call the model once the cap is reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const budget = createBudget({ dailyTokens: 100 })
    let calls = 0
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls++
        return speaking().doStream({} as never) as never
      },
    })

    const agent = createAgent({ index: await index(), model, embedder: false, budget })

    await agent.answer('refunds?')
    expect(calls).toBe(1)

    const second = await agent.answer('refunds again?')
    expect(calls).toBe(1)
    expect(second.text).toContain('person')
    // Not a documentation gap: retrieval never ran.
    expect(second.unanswered).toBe(false)
    warn.mockRestore()
  })

  it('bills a failed attempt as well as the one that answered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Burns its input tokens, then dies on the way back. Those tokens are
    // spent whether or not an answer came out of them.
    const wasteful = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'error' as const, error: new Error('429 rate limit') },
            { type: 'finish' as const, finishReason: { unified: 'error', raw: 'error' } as const, usage: used(400, 0) },
          ],
          chunkDelayInMs: 0,
        }),
      }),
    })

    const budget = createBudget({ dailyTokens: 1_000_000 })
    const agent = createAgent({
      index: await index(),
      model: wasteful,
      fallbackModel: speaking('Thirty days [1].', used(100, 50)),
      embedder: false,
      budget,
    })

    const result = await agent.answer('refunds?')
    expect(result.text).toContain('Thirty days')
    // 400 wasted on the first, 150 on the second. Charging only the second
    // would let a flapping provider spend the whole month uncounted.
    expect((await budget.spent()).day.tokens).toBe(550)

    warn.mockRestore()
    error.mockRestore()
  })

  it('still records the question a capped turn could not answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { memoryStore } = await import('../src/store/memory.js')
    const store = memoryStore()
    const budget = createBudget({ dailyTokens: 1 })
    await budget.record('openai/gpt-4o-mini', { inputTokens: 10, outputTokens: 0 })

    const agent = createAgent({ index: await index(), model: speaking(), embedder: false, budget, store })
    await agent.answer('is my parcel late?', [], { conversationId: 'c_capped' })

    const thread = await store.getConversation('c_capped')
    expect(thread?.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(thread?.messages[0]?.content).toBe('is my parcel late?')
    warn.mockRestore()
  })
})
