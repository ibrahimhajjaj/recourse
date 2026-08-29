import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { fileStore, memoryStore } from '../src/store/index.js'
import { message, storeBehaviour } from './store-suite.js'
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

// Both implementations must behave identically, or swapping one is a rewrite.
// The assertions live in store-suite.ts so a new implementation runs the same
// ones rather than a hand-copied approximation.
storeBehaviour('memory', () => memoryStore())
storeBehaviour('file', makeFileStore)

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
