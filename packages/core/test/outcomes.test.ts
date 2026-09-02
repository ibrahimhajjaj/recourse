import { describe, expect, it } from 'vitest'
import { outcomes } from '../src/outcomes.js'
import type { Conversation, Store, StoredMessage } from '../src/store/types.js'

const DAY = 24 * 60 * 60 * 1000

interface Ended {
  id: string
  email?: string
  at: number
  unanswered?: boolean
  ticketId?: string
  rated?: 'positive' | 'negative'
}

/**
 * A store with timestamps this test controls.
 *
 * The memory store stamps `updatedAt` on every write, which is right in
 * production and useless here: every conversation would have ended a moment
 * ago and nobody could ever have come back after one.
 */
function had(...ended: Ended[]): Store {
  const conversations: Conversation[] = ended.map((entry) => ({
    id: entry.id,
    channel: 'web',
    createdAt: new Date(entry.at).toISOString(),
    updatedAt: new Date(entry.at).toISOString(),
    ...(entry.email ? { contact: { email: entry.email } } : {}),
    ...(entry.ticketId ? { ticketId: entry.ticketId } : {}),
  }))

  return {
    async listConversations() {
      return { items: conversations }
    },
    async getConversation(id: string) {
      const conversation = conversations.find((entry) => entry.id === id)
      if (!conversation) return null

      const source = ended.find((entry) => entry.id === id)

      return {
        conversation,
        messages: [
          { id: `${id}-1`, role: 'user' as const, content: 'where is my order', createdAt: conversation.createdAt },
          {
            id: `${id}-2`,
            role: 'assistant' as const,
            content: 'It shipped on Tuesday.',
            createdAt: conversation.createdAt,
            ...(source?.unanswered ? { unanswered: true } : {}),
            ...(source?.rated ? { feedback: source.rated } : {}),
          },
        ],
      }
    },
  } as unknown as Store
}

describe('whether it helped, not whether it replied', () => {
  it('counts a customer who came back as a failure, not a win', async () => {
    const now = Date.now()
    const store = had(
      // Looked resolved on Monday. Back on Wednesday about something.
      { id: 'a', email: 'sam@example.com', at: now - 6 * DAY },
      { id: 'b', email: 'sam@example.com', at: now - 4 * DAY },
      // Asked once, never seen again.
      { id: 'c', email: 'alex@example.com', at: now - 5 * DAY },
    )

    const report = await outcomes({ store })

    // Every one of these is a win by deflection. One of them is not.
    expect(report.looksAnswered).toBe(3)
    expect(report.cameBack).toBe(1)
    expect(report.durable).toBe(2)
  })

  it('does not count a return outside the window', async () => {
    const now = Date.now()
    const store = had(
      { id: 'a', email: 'sam@example.com', at: now - 40 * DAY },
      { id: 'b', email: 'sam@example.com', at: now - 2 * DAY },
    )

    // A new question next month is a new question, not a failure of the last one.
    expect((await outcomes({ store })).cameBack).toBe(0)
  })

  it('keeps a handover and a refusal out of the answered count', async () => {
    const now = Date.now()
    const store = had(
      { id: 'a', email: 'a@example.com', at: now - DAY, ticketId: 'T-1' },
      { id: 'b', email: 'b@example.com', at: now - DAY, unanswered: true },
    )

    const report = await outcomes({ store })

    expect(report.escalated).toBe(1)
    expect(report.unanswered).toBe(1)
    expect(report.looksAnswered).toBe(0)
  })

  it('says how much it could not follow, rather than hiding it', async () => {
    const now = Date.now()
    // A widget conversation with nobody attached cannot be linked to the next
    // one, so a return is invisible. Reported, because it is the error bar.
    const store = had({ id: 'a', at: now - DAY }, { id: 'b', at: now - DAY })

    const report = await outcomes({ store })

    expect(report.anonymous).toBe(2)
    expect(report.durable).toBe(2)
    expect(report.cameBack).toBe(0)
  })

  it('adds up', async () => {
    const now = Date.now()
    const store = had(
      { id: 'a', email: 'sam@example.com', at: now - 6 * DAY },
      { id: 'b', email: 'sam@example.com', at: now - 4 * DAY },
      { id: 'c', at: now - 3 * DAY, ticketId: 'T-9' },
      { id: 'd', at: now - 2 * DAY, unanswered: true },
    )

    const report = await outcomes({ store })

    expect(report.looksAnswered + report.escalated + report.unanswered).toBe(report.conversations)
    expect(report.cameBack + report.durable).toBe(report.looksAnswered)
  })
})

describe('whether the agent is helping or intercepting', () => {
  it('splits the thumbs by whether a person ever joined', async () => {
    const now = Date.now()
    const store = had(
      { id: 'a', at: now - DAY, rated: 'positive' },
      { id: 'b', at: now - DAY, rated: 'negative' },
      { id: 'c', at: now - DAY, rated: 'negative' },
      { id: 'd', at: now - DAY, ticketId: 'T-1', rated: 'positive' },
      { id: 'e', at: now - DAY, ticketId: 'T-2', rated: 'positive' },
    )

    const report = await outcomes({ store })

    // One number would read as three positive to two negative and look fine.
    // Split, the agent is losing and the humans are carrying it.
    expect(report.rated.byAgent).toEqual({ positive: 1, negative: 2 })
    expect(report.rated.withPerson).toEqual({ positive: 2, negative: 0 })
  })

  it('counts nothing when nobody rated anything', async () => {
    const report = await outcomes({ store: had({ id: 'a', at: Date.now() - DAY }) })

    expect(report.rated.byAgent).toEqual({ positive: 0, negative: 0 })
    expect(report.rated.withPerson).toEqual({ positive: 0, negative: 0 })
  })
})

describe('what reading a report costs the store', () => {
  const three = () =>
    had(
      { id: 'a', at: Date.now() - DAY, rated: 'positive' },
      { id: 'b', at: Date.now() - DAY, unanswered: true },
      { id: 'c', at: Date.now() - DAY },
    )

  it('asks for the transcripts once, not once per conversation', async () => {
    const store = three()
    const one = store.getConversation.bind(store)
    let singles = 0
    let batches = 0

    const counted: Store = {
      ...store,
      async getConversation(id: string) {
        singles++
        return one(id)
      },
      async getConversations(ids: string[]) {
        batches++
        const threads: Array<{ conversation: Conversation; messages: StoredMessage[] }> = []
        for (const id of ids) {
          const thread = await one(id)
          if (thread) threads.push(thread)
        }
        return threads
      },
    }

    const report = await outcomes({ store: counted })

    expect(report.conversations).toBe(3)
    expect(report.unanswered).toBe(1)
    expect(report.rated.byAgent.positive).toBe(1)
    expect(batches).toBe(1)
    expect(singles).toBe(0)
  })

  it('falls back to reading them one at a time', async () => {
    // Every store written against the interface before this existed, which is
    // why the batch read is optional.
    const store = three()
    const one = store.getConversation.bind(store)
    let singles = 0
    const counted = {
      ...store,
      async getConversation(id: string) {
        singles++
        return one(id)
      },
    } as unknown as Store

    expect((await outcomes({ store: counted })).unanswered).toBe(1)
    expect(singles).toBe(3)
  })
})
