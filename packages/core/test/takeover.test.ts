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

describe('when the wait for a person runs out', () => {
  /**
   * The half that was built and never wired. `waitedTooLong`,
   * `UNANSWERED_MESSAGE` and `unansweredMessage` all existed, were exported and
   * were documented, and nothing called any of them. The agent simply started
   * answering again: the customer was never told the colleague was not coming,
   * the paused flag stayed set in the store, and no handover could be counted
   * as having timed out.
   */
  async function timedOut() {
    const store = memoryStore()
    const { model } = counting()
    const agent = createAgent({
      index: await index(),
      model,
      store,
      takeover: { waitForPersonMs: 1 },
    })

    await store.appendMessage('c_late', {
      id: 'm1',
      role: 'user',
      content: 'refunds?',
      createdAt: new Date().toISOString(),
    })
    await pauseAgent(store, 'c_late')
    // The clock runs from the handover, so a stale timestamp is the wait
    // having already elapsed.
    await new Promise((resolve) => setTimeout(resolve, 5))

    return { store, agent }
  }

  it('tells the customer nobody came, before answering', async () => {
    const { agent } = await timedOut()

    const result = await agent.answer('refunds?', [], { conversationId: 'c_late' })

    expect(result.text).toContain('Nobody is available to pick this up right now')
    // And still answers. The point is to stop the silence, not to refuse.
    expect(result.text).toContain('30 days')
  })

  it('lets a deployment write that sentence itself', async () => {
    const store = memoryStore()
    const { model } = counting()
    const agent = createAgent({
      index: await index(),
      model,
      store,
      takeover: { waitForPersonMs: 1, unansweredMessage: 'No one is about, but I can try.' },
    })

    await store.appendMessage('c_own', {
      id: 'm1',
      role: 'user',
      content: 'refunds?',
      createdAt: new Date().toISOString(),
    })
    await pauseAgent(store, 'c_own')
    await new Promise((resolve) => setTimeout(resolve, 5))

    const result = await agent.answer('refunds?', [], { conversationId: 'c_own' })
    expect(result.text).toContain('No one is about, but I can try.')
  })

  it('clears the paused flag, so nothing downstream still thinks a person has it', async () => {
    // Burst coalescing reads the raw flag rather than re-deriving it against
    // the clock. Left set, it drops the customer's next message entirely.
    const { store, agent } = await timedOut()

    await agent.answer('refunds?', [], { conversationId: 'c_late' })

    expect(await isPaused(store, 'c_late')).toBe(false)
    const thread = await store.getConversation('c_late')
    expect(thread?.conversation.meta?.aiPaused).not.toBe(true)
  })

  it('records that it ended because nobody came', async () => {
    // The question a support lead asks on day thirty is what fraction of
    // escalations timed out. A boolean cannot answer it.
    const { store, agent } = await timedOut()

    await agent.answer('refunds?', [], { conversationId: 'c_late' })

    const thread = await store.getConversation('c_late')
    expect(thread?.conversation.meta?.aiHandoverEndedBecause).toBe('nobody-came')
  })

  it('says nothing extra when a person is still within the wait', async () => {
    const store = memoryStore()
    const { model } = counting()
    const agent = createAgent({
      index: await index(),
      model,
      store,
      takeover: { waitForPersonMs: 60_000 },
    })

    await store.appendMessage('c_waiting', {
      id: 'm1',
      role: 'user',
      content: 'refunds?',
      createdAt: new Date().toISOString(),
    })
    await pauseAgent(store, 'c_waiting')

    const result = await agent.answer('refunds?', [], { conversationId: 'c_waiting' })
    expect(result.text).not.toContain('Nobody is available')
  })
})
