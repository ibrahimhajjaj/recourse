import { describe, expect, it } from 'vitest'
import { due, HOLD_KEYS, hold } from '../src/coalesce.js'
import { memoryStore } from '../src/store/index.js'
import { pauseAgent } from '../src/takeover.js'

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

describe('holding a conversation somebody else owns', () => {
  it('never arms a window once a person has taken it over', async () => {
    // Arming one would have the agent answer over the top of them when it
    // elapsed, which is the one thing a handover exists to prevent.
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'I want a human'))
    await pauseAgent(store, id)
    await store.appendMessage(id, said('user', 'are you there?'))

    await hold(id, { store, windowMs: 5000 })
    const meta = (await store.getConversation(id))?.conversation.meta

    expect(meta?.[HOLD_KEYS.dueAt]).toBeUndefined()
  })

  it('drops a hold when a person takes over mid-burst', async () => {
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'hello'))
    await hold(id, { store, windowMs: 5000 })
    await pauseAgent(store, id)
    await waited(store, id)

    expect(await due({ store, windowMs: 5000 })).toEqual([])
    // And the hold is gone rather than left to fire the moment they finish.
    expect((await store.getConversation(id))?.conversation.meta?.[HOLD_KEYS.dueAt]).toBeUndefined()
  })
})

describe('somebody who never stops typing', () => {
  it('answers anyway once the ceiling is reached', async () => {
    // A window that restarts on every message never ends for somebody writing
    // continuously, and they get silence instead of an answer.
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'still going'))
    await hold(id, { store, windowMs: 5000 })

    const thread = await store.getConversation(id)
    await store.updateConversation(id, {
      meta: {
        ...thread?.conversation.meta,
        [HOLD_KEYS.firstAt]: new Date(Date.now() - 60_000).toISOString(),
        [HOLD_KEYS.dueAt]: new Date(Date.now() + 5000).toISOString(),
      },
    })

    const ready = await due({ store, windowMs: 5000, maxWaitMs: 30_000 })
    expect(ready).toHaveLength(1)
  })

  it('measures the ceiling from the start of the burst, not the last message', async () => {
    const { store, id } = await conversation()
    await store.appendMessage(id, said('user', 'one'))
    await hold(id, { store, windowMs: 5000 })
    const first = (await store.getConversation(id))?.conversation.meta?.[HOLD_KEYS.firstAt]

    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.appendMessage(id, said('user', 'two'))
    await hold(id, { store, windowMs: 5000 })

    expect((await store.getConversation(id))?.conversation.meta?.[HOLD_KEYS.firstAt]).toBe(first)
  })
})

describe('a burst that is not a burst', () => {
  it('keeps the newest when somebody pastes two hundred lines', async () => {
    // The actual request is at the end of a paste, not the start, and sending
    // all of it to the model is a bill rather than a question.
    const { store, id } = await conversation()
    for (let at = 0; at < 200; at++) await store.appendMessage(id, said('user', `line ${at}`))
    await hold(id, { store, windowMs: 5000 })
    await waited(store, id)

    const ready = await due({ store, windowMs: 5000, maxMessages: 25 })

    expect(ready[0]?.messages).toHaveLength(25)
    expect(ready[0]?.messages.at(-1)?.content).toBe('line 199')
  })
})
