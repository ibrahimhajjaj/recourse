import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { insightOf, INSIGHT_KEYS, markChanged, summarise, summariseStale } from '../src/insights.js'
import { memoryStore } from '../src/store/index.js'

const usage = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
}

/** A model that answers with whatever it is told to, and records the prompt. */
function labeller(reply: string, seen: string[] = []) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      seen.push(JSON.stringify(options.prompt))

      return { finishReason: { unified: 'stop', raw: 'stop' } as const, usage, content: [{ type: 'text' as const, text: reply }], warnings: [] }
    },
  })
}

const GOOD = 'TITLE: Refund for a stale bag\nSUMMARY: Asked for a refund on order LUM-1234; told the 30 day window applies.\nMOOD: unhappy'

/** A whole message, because the store needs a timestamp to order by. */
const said = (at: number) => ({
  id: `m${at}`,
  role: (at % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
  content: `message ${at}`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, at)).toISOString(),
})

async function conversation(id = 'c1', turns = 2) {
  const store = memoryStore()
  for (let at = 0; at < turns; at++) await store.appendMessage(id, said(at))

  return store
}

describe('reading a conversation without opening it', () => {
  it('writes back a title, a summary and a mood', async () => {
    const store = await conversation()
    const insight = await summarise('c1', { store, model: labeller(GOOD) })

    expect(insight).toEqual({
      title: 'Refund for a stale bag',
      summary: 'Asked for a refund on order LUM-1234; told the 30 day window applies.',
      mood: 'unhappy',
    })

    const thread = await store.getConversation('c1')
    expect(insightOf(thread!.conversation)).toEqual(insight)
  })

  it('says nothing about a conversation of one message', async () => {
    // A greeting. Summarising it means paying for every abandoned tab.
    const store = await conversation('c1', 1)
    const seen: string[] = []

    expect(await summarise('c1', { store, model: labeller(GOOD, seen) })).toBeNull()
    expect(seen).toEqual([])
  })

  it('refuses a reply that is missing a line', async () => {
    // A title with no summary looks like a conversation nobody has looked at.
    const store = await conversation()

    expect(await summarise('c1', { store, model: labeller('TITLE: Something\nMOOD: happy') })).toBeNull()
  })

  it('refuses a mood it does not recognise', async () => {
    const store = await conversation()
    const odd = 'TITLE: A\nSUMMARY: B\nMOOD: incandescent'

    expect(await summarise('c1', { store, model: labeller(odd) })).toBeNull()
  })

  it('keeps the turn safe when the model cannot be reached', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = await conversation()
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('provider down')
      },
    })

    expect(await summarise('c1', { store, model: broken })).toBeNull()
    errors.mockRestore()
  })
})

describe('the mood as a state rather than a fresh guess', () => {
  it('tells the model what it decided last time', async () => {
    // Judging the last two messages alone makes it flip every turn.
    const store = await conversation()
    await summarise('c1', { store, model: labeller(GOOD) })

    const seen: string[] = []
    await summarise('c1', { store, model: labeller(GOOD, seen) })

    expect(seen[0]).toContain('unhappy')
  })

  it('says nothing about a previous mood on the first pass', async () => {
    const store = await conversation()
    const seen: string[] = []
    await summarise('c1', { store, model: labeller(GOOD, seen) })

    expect(seen[0]).not.toContain('last judged')
  })
})

describe('paying for it once rather than per message', () => {
  it('only summarises what was marked as changed', async () => {
    const store = memoryStore()
    for (const id of ['a', 'b', 'c']) {
      await store.appendMessage(id, said(0))
      await store.appendMessage(id, said(1))
    }
    await markChanged(store, 'b')

    const seen: string[] = []
    const result = await summariseStale({ store, model: labeller(GOOD, seen) })

    expect(result.done).toBe(1)
    expect(seen).toHaveLength(1)
  })

  it('clears the mark so the same one is not paid for twice', async () => {
    const store = await conversation()
    await markChanged(store, 'c1')
    await summariseStale({ store, model: labeller(GOOD) })

    const seen: string[] = []
    await summariseStale({ store, model: labeller(GOOD, seen) })

    expect(seen).toEqual([])
  })

  it('clears the mark even when the model keeps failing', async () => {
    // Otherwise one conversation it chokes on holds up the queue for ever.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = await conversation()
    await markChanged(store, 'c1')

    await summariseStale({ store, model: labeller('nonsense') })
    const thread = await store.getConversation('c1')

    expect(thread?.conversation.meta?.[INSIGHT_KEYS.stale]).toBe(false)
    errors.mockRestore()
  })

  it('does not run away with a backlog', async () => {
    const store = memoryStore()
    for (let at = 0; at < 12; at++) {
      await store.appendMessage(`c${at}`, said(0))
      await store.appendMessage(`c${at}`, said(1))
      await markChanged(store, `c${at}`)
    }

    const seen: string[] = []
    await summariseStale({ store, model: labeller(GOOD, seen), limit: 5 })

    expect(seen).toHaveLength(5)
  })
})
