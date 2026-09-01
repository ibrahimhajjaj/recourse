import { describe, expect, it } from 'vitest'
import {
  assignAgent,
  endedBecause,
  hasPerson,
  isEndCommand,
  isPaused,
  pauseAgent,
  resumeAgent,
} from '../src/takeover.js'
import { memoryStore } from '../src/store/index.js'

const seeded = async (id = 'c1') => {
  const store = memoryStore()
  await store.appendMessage(id, { id: 'm0', role: 'user', content: 'I need a person', createdAt: new Date().toISOString() })

  return store
}

describe('asked for a person, versus having one', () => {
  it('knows the difference', async () => {
    // The gap between these two is where the customer sits wondering whether
    // anybody is coming.
    const store = await seeded()
    await pauseAgent(store, 'c1', { assigned: false })

    expect(await isPaused(store, 'c1')).toBe(true)
    expect(await hasPerson(store, 'c1')).toBe(false)

    await assignAgent(store, 'c1', 'Marcus')
    expect(await hasPerson(store, 'c1')).toBe(true)
  })

  it('treats a person clicking take over as them being there', async () => {
    // The usual caller is a dashboard, and they are by definition present.
    const store = await seeded()
    await pauseAgent(store, 'c1')

    expect(await hasPerson(store, 'c1')).toBe(true)
  })
})

describe('why a handover ended', () => {
  it('records a person finishing with it', async () => {
    const store = await seeded()
    await assignAgent(store, 'c1', 'Marcus')
    await resumeAgent(store, 'c1')

    expect(await endedBecause(store, 'c1')).toBe('person-finished')
    expect(await isPaused(store, 'c1')).toBe(false)
  })

  it('records nobody having come', async () => {
    // "What fraction of our escalations ended because nobody came" is the
    // question a support lead asks, and a boolean cannot answer it.
    const store = await seeded()
    await pauseAgent(store, 'c1', { assigned: false })
    await resumeAgent(store, 'c1', 'nobody-came')

    expect(await endedBecause(store, 'c1')).toBe('nobody-came')
  })

  it('records the customer giving up', async () => {
    const store = await seeded()
    await pauseAgent(store, 'c1', { assigned: false })
    await resumeAgent(store, 'c1', 'customer-ended')

    expect(await endedBecause(store, 'c1')).toBe('customer-ended')
  })

  it('says nothing about a conversation no person ever touched', async () => {
    const store = await seeded()

    expect(await endedBecause(store, 'c1')).toBeNull()
  })

  it('clears the assignment when it ends, so the next handover starts fresh', async () => {
    const store = await seeded()
    await assignAgent(store, 'c1', 'Marcus')
    await resumeAgent(store, 'c1')

    expect(await hasPerson(store, 'c1')).toBe(false)
  })
})

describe('the customer saying they are done waiting', () => {
  it('recognises the ways somebody types it', () => {
    for (const said of ['/end', '/END', '  /end  ', '/cancel', '/bot']) {
      expect(isEndCommand(said), said).toBe(true)
    }
  })

  it('is not fooled by a sentence containing the word', () => {
    // "I want to end my subscription" is a support question, not a command.
    for (const said of [
      'I want to end my subscription',
      'can you cancel my order',
      'end of the month please',
      'is this a bot',
    ]) {
      expect(isEndCommand(said), said).toBe(false)
    }
  })
})

describe('what the agent says while it waits', () => {
  async function agentWith(assigned: boolean) {
    const { createAgent } = await import('../src/agent.js')
    const { buildIndex } = await import('../src/knowledge/build.js')
    const { textSource } = await import('../src/sources/text.js')
    const { MockLanguageModelV4 } = await import('ai/test')
    const { simulateReadableStream } = await import('ai')

    const usage = {
      inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    }
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '0' },
            { type: 'text-delta' as const, id: '0', delta: 'the agent answered' },
            { type: 'text-end' as const, id: '0' },
            { type: 'finish' as const, finishReason: { unified: 'stop', raw: 'stop' } as const, usage },
          ],
          chunkDelayInMs: 0,
        }),
      }),
    })

    const store = memoryStore()
    const index = await buildIndex({
      sources: [textSource([{ id: 'd', title: 'D', text: 'Delivery takes four days.' }])],
      embed: false,
    })
    const agent = createAgent({ index, model, embedder: false, classifier: false, store, takeover: true })

    await agent.answer('how long is delivery', [], { conversationId: 'c_w' })
    await pauseAgent(store, 'c_w', { assigned })

    return { agent, store }
  }

  it('says somebody is coming, not that they are already here', async () => {
    // Telling a queuing customer a colleague has it makes them wait longer.
    const { agent } = await agentWith(false)
    const said = await agent.answer('anyone there?', [], { conversationId: 'c_w' })

    expect(said.text).toContain('someone will reply')
    expect(said.text).not.toContain('colleague')
  })

  it('says a colleague has it once one actually does', async () => {
    const { agent } = await agentWith(true)
    const said = await agent.answer('anyone there?', [], { conversationId: 'c_w' })

    expect(said.text).toContain('colleague')
  })

  it('gives the conversation back when the customer says they are done', async () => {
    // Their only alternative is closing the tab, which is a conversation
    // nobody can follow up.
    const { agent, store } = await agentWith(false)
    await agent.answer('/end', [], { conversationId: 'c_w' })

    expect(await isPaused(store, 'c_w')).toBe(false)
    expect(await endedBecause(store, 'c_w')).toBe('customer-ended')
  })
})
