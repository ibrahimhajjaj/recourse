import { describe, expect, it } from 'vitest'
import { isPaused, pauseAgent, waitedTooLong } from '../src/takeover.js'
import { memoryStore } from '../src/store/index.js'

/** A store holding one conversation that was handed over `agoMs` ago. */
async function handedOver(agoMs: number) {
  const store = memoryStore()
  await store.appendMessage('c1', { role: 'user', content: 'I need a person' })
  await pauseAgent(store, 'c1')

  if (agoMs > 0) {
    const thread = await store.getConversation('c1')
    const meta = { ...thread?.conversation.meta, aiPausedAt: new Date(Date.now() - agoMs).toISOString() }
    await store.updateConversation('c1', { meta })
  }

  return store
}

describe('a handover nobody picks up', () => {
  it('stays quiet while somebody might still come', async () => {
    const store = await handedOver(60_000)

    expect(await isPaused(store, 'c1', 10 * 60_000)).toBe(true)
    expect(await waitedTooLong(store, 'c1', 10 * 60_000)).toBe(false)
  })

  it('hands itself back once the wait runs out', async () => {
    // Otherwise an escalation at two in the morning ends the conversation
    // without anybody deciding to.
    const store = await handedOver(20 * 60_000)

    expect(await isPaused(store, 'c1', 10 * 60_000)).toBe(false)
    expect(await waitedTooLong(store, 'c1', 10 * 60_000)).toBe(true)
  })

  it('waits forever when no wait was configured', async () => {
    // What it did before this existed, and still the default.
    const store = await handedOver(365 * 24 * 60 * 60_000)

    expect(await isPaused(store, 'c1')).toBe(true)
    expect(await waitedTooLong(store, 'c1')).toBe(false)
  })

  it('keeps waiting when the timestamp is missing or unreadable', async () => {
    // Handing a conversation back because a date failed to parse would be the
    // agent talking over a person who really is there.
    const store = memoryStore()
    await store.appendMessage('c2', { role: 'user', content: 'hello' })
    await store.updateConversation('c2', { meta: { aiPaused: true } })

    expect(await isPaused(store, 'c2', 1000)).toBe(true)

    await store.updateConversation('c2', { meta: { aiPaused: true, aiPausedAt: 'not a date' } })
    expect(await isPaused(store, 'c2', 1000)).toBe(true)
  })

  it('says nothing about a conversation no person ever took', async () => {
    const store = memoryStore()
    await store.appendMessage('c3', { role: 'user', content: 'hello' })

    expect(await isPaused(store, 'c3', 1000)).toBe(false)
    expect(await waitedTooLong(store, 'c3', 1000)).toBe(false)
  })
})
