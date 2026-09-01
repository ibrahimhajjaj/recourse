import { describe, expect, it } from 'vitest'
import { due, HOLD_KEYS, hold } from '../src/coalesce.js'
import { memoryStore } from '../src/store/index.js'

let clock = 0
const said = (role: 'user' | 'assistant', content: string) => ({
  id: `m${clock}`,
  role,
  content,
  createdAt: new Date(Date.UTC(2026, 0, 1) + clock++ * 1000).toISOString(),
})

async function conversation(id = 'c1') {
  const store = memoryStore()
  return { store, id }
}

/** Moves the hold into the past, the way waiting would. */
async function waited(store: ReturnType<typeof memoryStore>, id: string) {
  const thread = await store.getConversation(id)
  await store.updateConversation(id, {
    meta: { ...thread?.conversation.meta, [HOLD_KEYS.dueAt]: new Date(Date.now() - 1000).toISOString() },
  })
}

describe('one thought sent as four messages', () => {
  it('answers none of them while the customer is still typing', async () => {
    const { store, id } = await conversation()

    for (const text of ['hi', 'I have a problem', 'with my order']) {
      await store.appendMessage(id, said('user', text))
      expect((await hold(id, { store, windowMs: 5000 })).ready).toBe(false)
    }
  })

  it('answers the whole burst once the silence lasts', async () => {
    const { store, id } = await conversation()

    for (const text of ['hi', 'my order', 'LUM-1234']) {
      await store.appendMessage(id, said('user', text))
      await hold(id, { store, windowMs: 5000 })
    }

    await waited(store, id)
    const ready = await due({ store, windowMs: 5000 })

    expect(ready).toHaveLength(1)
    expect(ready[0]?.messages.map((message) => message.content)).toEqual(['hi', 'my order', 'LUM-1234'])
  })

  it('starts a new burst after the agent has replied', async () => {
    // Otherwise the second question arrives carrying the first one.
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'first question'))
    await store.appendMessage(id, said('assistant', 'here is the answer'))
    await store.appendMessage(id, said('user', 'second question'))
    await hold(id, { store, windowMs: 5000 })
    await waited(store, id)

    const ready = await due({ store, windowMs: 5000 })

    expect(ready[0]?.messages.map((message) => message.content)).toEqual(['second question'])
  })

  it('answers immediately when the window is off', async () => {
    // What the web widget wants: somebody typing into a box sends one message
    // and waits for it.
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'where is my order'))

    const result = await hold(id, { store, windowMs: 0 })

    expect(result.ready).toBe(true)
    expect(result.messages.map((message) => message.content)).toEqual(['where is my order'])
  })

  it('restarts the wait on every message rather than timing from the first', async () => {
    // A timer from "hi" cuts a long burst in half.
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'hi'))
    await hold(id, { store, windowMs: 5000 })
    const first = (await store.getConversation(id))?.conversation.meta?.[HOLD_KEYS.dueAt]

    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.appendMessage(id, said('user', 'still typing'))
    await hold(id, { store, windowMs: 5000 })
    const second = (await store.getConversation(id))?.conversation.meta?.[HOLD_KEYS.dueAt]

    expect(String(second) > String(first)).toBe(true)
  })

  it('is not due before the silence has lasted', async () => {
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'hi'))
    await hold(id, { store, windowMs: 60_000 })

    expect(await due({ store, windowMs: 60_000 })).toEqual([])
  })

  it('hands a burst to one sweeper, not two', async () => {
    // Two crons overlapping must not both answer the same messages.
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'hello'))
    await hold(id, { store, windowMs: 5000 })
    await waited(store, id)

    const [first, second] = await Promise.all([
      due({ store, windowMs: 5000 }),
      due({ store, windowMs: 5000 }),
    ])

    expect(first.length + second.length).toBe(1)
  })

  it('leaves a conversation nobody is holding alone', async () => {
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'hello'))

    expect(await due({ store, windowMs: 5000 })).toEqual([])
  })
})
