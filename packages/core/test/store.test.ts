import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { fileStore, memoryStore } from '../src/store/index.js'
import type { Store, StoredMessage } from '../src/store/index.js'
import { createAgent } from '../src/agent.js'
import { collectLeads } from '../src/actions/index.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import type { KnowledgeIndex } from '../src/types.js'

const temporaryDirs: string[] = []

afterEach(async () => {
  for (const dir of temporaryDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function makeFileStore(): Promise<Store> {
  const dir = await mkdtemp(join(tmpdir(), 'helpdeck-store-'))
  temporaryDirs.push(dir)
  return fileStore({ dir })
}

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: `m${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: 'hello',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [
      textSource([
        { id: 'refunds', title: 'Refunds', text: '# Refunds\n\nWe refund any order within 30 days.' },
      ]),
    ],
  })
  return cached
}

/** Both implementations must behave identically, or swapping one is a rewrite. */
const implementations: Array<[string, () => Promise<Store> | Store]> = [
  ['memory', () => memoryStore()],
  ['file', makeFileStore],
]

for (const [name, make] of implementations) {
  describe(`${name} store`, () => {
    it('creates the conversation on the first message', async () => {
      const store = await make()
      await store.appendMessage('c1', message({ content: 'where is my order' }), { channel: 'web' })

      const found = await store.getConversation('c1')
      expect(found?.conversation.channel).toBe('web')
      expect(found?.messages).toHaveLength(1)
    })

    it('returns null for a conversation that never existed', async () => {
      expect(await (await make()).getConversation('nope')).toBeNull()
    })

    it('orders conversations by most recently updated', async () => {
      const store = await make()
      await store.appendMessage('old', message({ createdAt: '2026-01-01T00:00:00.000Z' }))
      await store.appendMessage('new', message({ createdAt: '2026-06-01T00:00:00.000Z' }))

      const page = await store.listConversations()
      expect(page.items[0]?.id).toBe('new')
    })

    it('paginates with a stable cursor', async () => {
      const store = await make()
      for (let i = 0; i < 5; i++) {
        await store.appendMessage(`c${i}`, message({ createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }))
      }

      const first = await store.listConversations({ limit: 2 })
      expect(first.items).toHaveLength(2)
      expect(first.cursor).toBeTruthy()

      const second = await store.listConversations({ limit: 2, cursor: first.cursor })
      expect(second.items.map((c) => c.id)).not.toContain(first.items[0]?.id)
    })

    it('has no cursor on the last page', async () => {
      const store = await make()
      await store.appendMessage('only', message())
      expect((await store.listConversations({ limit: 10 })).cursor).toBeUndefined()
    })

    it('filters by channel', async () => {
      const store = await make()
      await store.appendMessage('w', message(), { channel: 'web' })
      await store.appendMessage('e', message(), { channel: 'email' })

      const page = await store.listConversations({ channel: 'email' })
      expect(page.items.map((c) => c.id)).toEqual(['e'])
    })

    it('finds the conversations where the agent could not answer', async () => {
      const store = await make()
      await store.appendMessage('good', message({ role: 'assistant', unanswered: false }))
      await store.appendMessage('gap', message({ role: 'assistant', unanswered: true }))

      const page = await store.listConversations({ unansweredOnly: true })
      expect(page.items.map((c) => c.id)).toEqual(['gap'])
    })

    it('records thumbs up and down against a message', async () => {
      const store = await make()
      const reply = message({ role: 'assistant', content: 'thirty days' })
      await store.appendMessage('c1', reply)
      await store.setFeedback('c1', reply.id, 'negative')

      const found = await store.getConversation('c1')
      expect(found?.messages[0]?.feedback).toBe('negative')
    })

    it('stores and lists leads newest first', async () => {
      const store = await make()
      await store.saveLead({ id: 'l1', createdAt: '2026-01-01T00:00:00.000Z', values: { email: 'a@b.co' } })
      await store.saveLead({ id: 'l2', createdAt: '2026-02-01T00:00:00.000Z', values: { email: 'c@d.co' } })

      const page = await store.listLeads()
      expect(page.items.map((lead) => lead.id)).toEqual(['l2', 'l1'])
    })

    it('reports the numbers a support lead actually looks at', async () => {
      const store = await make()
      await store.appendMessage('c1', message({ content: 'do you sell tea' }), { channel: 'web' })
      await store.appendMessage('c1', message({ role: 'assistant', unanswered: true }))
      await store.appendMessage('c2', message({ content: 'do you sell tea' }), { channel: 'whatsapp' })
      await store.appendMessage('c2', message({ role: 'assistant', unanswered: true }))
      await store.saveLead({ id: 'l1', createdAt: new Date().toISOString(), values: {} })

      const stats = await store.stats()
      expect(stats.conversations).toBe(2)
      expect(stats.unanswered).toBe(2)
      expect(stats.leads).toBe(1)
      expect(stats.byChannel).toEqual({ web: 1, whatsapp: 1 })
      // The same missing answer asked twice is the top gap to go and write.
      expect(stats.topGaps[0]).toEqual({ question: 'do you sell tea', count: 2 })
    })
  })
}

describe('file store durability', () => {
  it('reads back everything after a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helpdeck-store-'))
    temporaryDirs.push(dir)

    const first = fileStore({ dir })
    const reply = message({ role: 'assistant', content: 'thirty days' })
    await first.appendMessage('c1', message({ content: 'refunds?' }), { channel: 'email' })
    await first.appendMessage('c1', reply)
    await first.setFeedback('c1', reply.id, 'positive')
    await first.saveLead({ id: 'l1', createdAt: new Date().toISOString(), values: { email: 'a@b.co' } })

    // A completely fresh instance, as after a deploy or a crash.
    const second = fileStore({ dir })
    const found = await second.getConversation('c1')

    expect(found?.messages).toHaveLength(2)
    expect(found?.conversation.channel).toBe('email')
    expect(found?.messages[1]?.feedback).toBe('positive')
    expect((await second.listLeads()).items).toHaveLength(1)
  })

  it('survives a truncated final line rather than losing the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helpdeck-store-'))
    temporaryDirs.push(dir)

    const first = fileStore({ dir })
    await first.appendMessage('c1', message())

    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(dir, 'conversations.jsonl'), '{"kind":"message","conv\n', 'utf8')

    const second = fileStore({ dir })
    expect((await second.getConversation('c1'))?.messages).toHaveLength(1)
  })
})

describe('the agent recording to a store', () => {
  function model(text: string) {
    return new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '0' },
            { type: 'text-delta' as const, id: '0', delta: text },
            { type: 'text-end' as const, id: '0' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop', raw: 'stop' } as const,
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
          chunkDelayInMs: 0,
        }),
      }),
    })
  }

  it('writes both sides of the exchange', async () => {
    const store = memoryStore()
    const agent = createAgent({ index: await index(), model: model('Thirty days.'), store })

    await agent.answer('what is the refund window', [], { conversationId: 'c1', channel: 'web' })

    const found = await store.getConversation('c1')
    expect(found?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(found?.messages[1]?.content).toBe('Thirty days.')
    expect(found?.messages[1]?.sources?.length).toBeGreaterThan(0)
  })

  it('marks a turn it could not answer, so the gap shows up in analytics', async () => {
    const store = memoryStore()
    const agent = createAgent({ index: await index(), model: model('I cannot help.'), store })

    await agent.answer('what is the capital of Mongolia', [], { conversationId: 'c2' })

    const stats = await store.stats()
    expect(stats.unanswered).toBe(1)
    expect(stats.topGaps[0]?.question).toBe('what is the capital of mongolia')
  })

  it('saves a captured lead without the host wiring a callback', async () => {
    const store = memoryStore()
    const agent = createAgent({
      index: await index(),
      model: model('ok'),
      store,
      actions: [collectLeads({})],
    })

    // Drive the action directly: the tool-calling path is covered elsewhere.
    const action = collectLeads({})
    await action.execute?.({ email: 'sam@example.com' }, { store, conversationId: 'c3', emit: () => {} })

    const leads = await store.listLeads()
    expect(leads.items[0]?.values).toEqual({ email: 'sam@example.com' })
    expect(leads.items[0]?.conversationId).toBe('c3')
    expect(agent).toBeDefined()
  })

  it('generates a conversation id when the caller does not supply one', async () => {
    const store = memoryStore()
    const agent = createAgent({ index: await index(), model: model('hi'), store })

    await agent.answer('refund window')

    const page = await store.listConversations()
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.id).toMatch(/^c_/)
  })
})

describe('a turn the browser interrupted', () => {
  function model(text: string) {
    return new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '0' },
            { type: 'text-delta' as const, id: '0', delta: text },
            { type: 'text-end' as const, id: '0' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop', raw: 'stop' } as const,
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
          chunkDelayInMs: 0,
        }),
      }),
    })
  }

  it('records the exchange once, not once per pass', async () => {
    const store = memoryStore()
    const agent = createAgent({ index: await index(), model: model('Your basket has 2 items.'), store })

    await agent.answer('what is in my basket', [], { conversationId: 'c1' })
    await agent.answer('what is in my basket', [], {
      conversationId: 'c1',
      clientResults: [{ name: 'read_basket', output: { items: 2 } }],
    })

    const found = await store.getConversation('c1')
    expect(found?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant'])
    // The customer asked once, so their question appears once.
    expect(found?.messages.filter((m) => m.role === 'user')).toHaveLength(1)
  })

  it('keeps no blank reply from the paused half of the turn', async () => {
    const store = memoryStore()
    const silent = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop', raw: 'stop' } as const,
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
          chunkDelayInMs: 0,
        }),
      }),
    })

    const agent = createAgent({ index: await index(), model: silent, store })
    await agent.answer('what is in my basket', [], { conversationId: 'c2' })

    const found = await store.getConversation('c2')
    expect(found?.messages.map((m) => m.role)).toEqual(['user'])
  })
})
