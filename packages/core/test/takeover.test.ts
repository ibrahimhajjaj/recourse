import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { memoryStore } from '../src/store/memory.js'
import { isPaused, pauseAgent, resumeAgent } from '../src/takeover.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [textSource([{ id: 'refunds', title: 'Refunds', text: '# Refunds\n\nRefunds take 30 days.' }])],
  })
  return cached
}

function counting() {
  let calls = 0
  const model = new MockLanguageModelV4({
    doStream: async () => {
      calls++
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '0' },
            { type: 'text-delta' as const, id: '0', delta: 'Refunds take 30 days [1].' },
            { type: 'text-end' as const, id: '0' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop', raw: 'stop' } as const,
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
          chunkDelayInMs: 0,
        }),
      }
    },
  })
  return { model, calls: () => calls }
}

describe('the pause flag', () => {
  it('is off until somebody takes the conversation', async () => {
    const store = memoryStore()
    await store.appendMessage('c_1', { id: 'm1', role: 'user', content: 'hi', createdAt: new Date().toISOString() })

    expect(await isPaused(store, 'c_1')).toBe(false)
    await pauseAgent(store, 'c_1')
    expect(await isPaused(store, 'c_1')).toBe(true)
    await resumeAgent(store, 'c_1')
    expect(await isPaused(store, 'c_1')).toBe(false)
  })

  it('says false for a conversation nobody has started', async () => {
    expect(await isPaused(memoryStore(), 'c_nothing')).toBe(false)
  })

  it('keeps whatever else was on the conversation', async () => {
    const store = memoryStore()
    await store.appendMessage(
      'c_2',
      { id: 'm1', role: 'user', content: 'hi', createdAt: new Date().toISOString() },
      { meta: { country: 'IE' } },
    )

    await pauseAgent(store, 'c_2')
    const thread = await store.getConversation('c_2')
    expect(thread?.conversation.meta?.country).toBe('IE')
    expect(thread?.conversation.meta?.aiPaused).toBe(true)
  })

  it('answers rather than going silent when the store cannot be read', async () => {
    const broken = {
      ...memoryStore(),
      getConversation: async () => {
        throw new Error('database is down')
      },
    }

    // Failing closed here would silence the agent for every customer at once.
    expect(await isPaused(broken as never, 'c_3')).toBe(false)
  })
})

describe('an agent in a conversation a person owns', () => {
  it('stops answering and says who has it', async () => {
    const store = memoryStore()
    const { model, calls } = counting()
    const agent = createAgent({ index: await index(), model, embedder: false, store, takeover: true })

    const first = await agent.answer('refunds?', [], { conversationId: 'c_live' })
    expect(first.text).toContain('30 days')
    expect(calls()).toBe(1)

    await pauseAgent(store, 'c_live')

    const second = await agent.answer('are you sure?', [], { conversationId: 'c_live' })
    expect(second.text).toContain('colleague')
    // The whole point: the model was never called a second time.
    expect(calls()).toBe(1)
  })

  it('still records what the customer said, so the person sees it', async () => {
    const store = memoryStore()
    const { model } = counting()
    const agent = createAgent({ index: await index(), model, embedder: false, store, takeover: true })

    await store.appendMessage('c_seen', {
      id: 'm0',
      role: 'user',
      content: 'first',
      createdAt: new Date().toISOString(),
    })
    await pauseAgent(store, 'c_seen')
    await agent.answer('my order is still missing', [], { conversationId: 'c_seen' })

    const thread = await store.getConversation('c_seen')
    expect(thread?.messages.map((message) => message.content)).toContain('my order is still missing')
  })

  it('does not count a paused turn as a documentation gap', async () => {
    const store = memoryStore()
    const { model } = counting()
    const agent = createAgent({ index: await index(), model, embedder: false, store, takeover: true })

    await store.appendMessage('c_gap', { id: 'm0', role: 'user', content: 'x', createdAt: new Date().toISOString() })
    await pauseAgent(store, 'c_gap')

    const result = await agent.answer('something nothing covers', [], { conversationId: 'c_gap' })
    expect(result.unanswered).toBe(false)

    const stats = await store.stats()
    expect(stats.topGaps.map((gap) => gap.question)).not.toContain('something nothing covers')
  })

  it('answers again once the person hands it back', async () => {
    const store = memoryStore()
    const { model, calls } = counting()
    const agent = createAgent({ index: await index(), model, embedder: false, store, takeover: true })

    await store.appendMessage('c_back', { id: 'm0', role: 'user', content: 'x', createdAt: new Date().toISOString() })
    await pauseAgent(store, 'c_back')
    await agent.answer('one', [], { conversationId: 'c_back' })
    expect(calls()).toBe(0)

    await resumeAgent(store, 'c_back')
    await agent.answer('refunds?', [], { conversationId: 'c_back' })
    expect(calls()).toBe(1)
  })

  it('uses the wording the deployment chose', async () => {
    const store = memoryStore()
    const { model } = counting()
    const agent = createAgent({
      index: await index(),
      model,
      embedder: false,
      store,
      takeover: { message: 'Sam is with you now.' },
    })

    await store.appendMessage('c_named', { id: 'm0', role: 'user', content: 'x', createdAt: new Date().toISOString() })
    await pauseAgent(store, 'c_named')

    expect((await agent.answer('hello?', [], { conversationId: 'c_named' })).text).toBe('Sam is with you now.')
  })

  it('costs nothing when the deployment has not asked for it', async () => {
    const store = memoryStore()
    const { model, calls } = counting()
    // No `takeover`, so the flag is never read and the agent keeps answering.
    const agent = createAgent({ index: await index(), model, embedder: false, store })

    await store.appendMessage('c_off', { id: 'm0', role: 'user', content: 'x', createdAt: new Date().toISOString() })
    await pauseAgent(store, 'c_off')
    await agent.answer('refunds?', [], { conversationId: 'c_off' })

    expect(calls()).toBe(1)
  })
})
