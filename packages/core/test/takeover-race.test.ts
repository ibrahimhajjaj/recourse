import { describe, expect, it } from 'vitest'
import { assignAgent, heldBy, hasPerson, resumeAgent } from '../src/takeover.js'
import { memoryStore } from '../src/store/index.js'
import type { Store } from '../src/store/types.js'

/**
 * Two people clicking "take over" in the same second, which is not a
 * hypothetical on a busy desk.
 */

async function conversation(): Promise<Store> {
  const store = memoryStore()
  await store.appendMessage(
    'c1',
    { id: 'm1', role: 'user', content: 'this is going badly', createdAt: new Date().toISOString() },
    { channel: 'web' },
  )
  return store
}

describe('a second person taking over', () => {
  it('is refused, and told who has it', async () => {
    // Letting them win leaves the first typing into a conversation somebody
    // else now owns, with neither of them told.
    const store = await conversation()

    expect(await assignAgent(store, 'c1', 'ana')).toEqual({ assigned: true, heldBy: 'ana' })
    expect(await assignAgent(store, 'c1', 'marcus')).toEqual({ assigned: false, heldBy: 'ana' })

    expect(await heldBy(store, 'c1')).toBe('ana')
  })

  it('lets the same person take it again, which is a double click', async () => {
    const store = await conversation()

    await assignAgent(store, 'c1', 'ana')
    expect((await assignAgent(store, 'c1', 'ana')).assigned).toBe(true)
  })

  it('can be handed over deliberately', async () => {
    // A manager reassigning is making a decision, not racing.
    const store = await conversation()

    await assignAgent(store, 'c1', 'ana')
    expect(await assignAgent(store, 'c1', 'marcus', { takeFrom: true })).toEqual({
      assigned: true,
      heldBy: 'marcus',
    })
    expect(await heldBy(store, 'c1')).toBe('marcus')
  })

  it('is free again once the first person is finished', async () => {
    const store = await conversation()

    await assignAgent(store, 'c1', 'ana')
    await resumeAgent(store, 'c1')

    expect(await heldBy(store, 'c1')).toBeUndefined()
    expect((await assignAgent(store, 'c1', 'marcus')).assigned).toBe(true)
  })

  it('counts a nameless takeover as held', async () => {
    const store = await conversation()

    await assignAgent(store, 'c1')
    expect(await hasPerson(store, 'c1')).toBe(true)
    expect((await assignAgent(store, 'c1', 'marcus')).assigned).toBe(false)
  })

  it('is free on a conversation nobody has touched', async () => {
    expect(await heldBy(await conversation(), 'c1')).toBeUndefined()
  })
})

describe('when the store cannot answer', () => {
  it('refuses to guess who owns the conversation', async () => {
    // Answering "nobody has it" when the truth is "I could not tell" turns the
    // check off exactly when it is needed, and two people end up owning the
    // same conversation.
    const store = await conversation()
    await assignAgent(store, 'c1', 'ana')

    const broken: Store = {
      ...store,
      getConversation: async () => {
        throw new Error('the store is having a moment')
      },
    }

    await expect(assignAgent(broken, 'c1', 'marcus')).rejects.toThrow(/having a moment/)
  })

  it('still lets a deliberate reassignment through, which asked no question', async () => {
    const store = await conversation()
    await assignAgent(store, 'c1', 'ana')

    const broken: Store = {
      ...store,
      getConversation: async () => {
        throw new Error('the store is having a moment')
      },
    }

    expect((await assignAgent(broken, 'c1', 'marcus', { takeFrom: true })).assigned).toBe(true)
  })

  it('leaves the read-only lookup lenient, since it only shows a name', async () => {
    const broken: Store = {
      ...(await conversation()),
      getConversation: async () => {
        throw new Error('the store is having a moment')
      },
    }

    expect(await heldBy(broken, 'c1')).toBeUndefined()
  })
})
