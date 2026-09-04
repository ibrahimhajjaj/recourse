import { describe, expect, it } from 'vitest'
import { memoryStore } from '../src/store/index.js'
import { orderingOf, ticketCursor, ticketCursorAt } from '../src/helpdesk/ordering.js'
import type { Store } from '../src/store/types.js'

/**
 * The order a queue comes back in, and what a cursor means inside it.
 *
 * A keyset cursor is a position in one particular ordering. Handed to a
 * differently sorted query it points at a row that has moved, and the page
 * that comes back is quietly wrong rather than empty, which is the worst way
 * for paging to fail.
 */

async function seeded(): Promise<Store> {
  const store = memoryStore()

  // Opened oldest first, touched in a different order, replied to in a third.
  for (const [subject, createdAt, updatedAt, lastMessageAt] of [
    ['First opened', '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'],
    ['Second opened', '2026-01-02T00:00:00.000Z', '2026-01-05T00:00:00.000Z', undefined],
    ['Third opened', '2026-01-03T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'],
  ] as const) {
    const ticket = await store.createTicket({
      subject,
      description: subject,
      statusId: 'new',
      statusCategory: 'new',
      customer: { email: 'sam@example.com' },
      channel: 'web',
      metadata: {},
      createdAt,
      updatedAt,
      ...(lastMessageAt ? { lastMessageAt } : {}),
    })

    // createTicket stamps its own times, so put the intended ones back.
    await store.updateTicket(ticket.ticketNumber, {
      createdAt,
      updatedAt,
      ...(lastMessageAt ? { lastMessageAt } : {}),
    })
  }

  return store
}

const subjects = (page: { items: Array<{ subject: string }> }) => page.items.map((ticket) => ticket.subject)

describe('the order a queue comes back in', () => {
  it('is most recently touched first, unless told otherwise', async () => {
    const store = await seeded()

    expect(subjects(await store.listTickets())).toEqual(['First opened', 'Third opened', 'Second opened'])
  })

  it('can be oldest first, which is the order a queue is worked in', async () => {
    const store = await seeded()

    expect(subjects(await store.listTickets({ sortBy: 'created', order: 'asc' }))).toEqual([
      'First opened',
      'Second opened',
      'Third opened',
    ])
  })

  it('can be when it was opened, which is the only one that cannot move', async () => {
    const store = await seeded()

    expect(subjects(await store.listTickets({ sortBy: 'created' }))).toEqual([
      'Third opened',
      'Second opened',
      'First opened',
    ])
  })

  it('puts a ticket nobody replied to at the old end rather than nowhere', async () => {
    // "Second opened" has no last message, so it sorts by when it was opened.
    const store = await seeded()

    expect(subjects(await store.listTickets({ sortBy: 'lastMessage' }))).toEqual([
      'Third opened',
      'First opened',
      'Second opened',
    ])
  })
})

describe('counting them', () => {
  it('says how many matched, not how many came back', async () => {
    const store = await seeded()
    const page = await store.listTickets({ limit: 1, includeTotal: true })

    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(3)
  })

  it('counts what the filter matched', async () => {
    const store = await seeded()

    expect((await store.listTickets({ channel: 'sms', includeTotal: true })).total).toBe(0)
  })

  it('says nothing about totals unless asked, since it is a second query', async () => {
    const store = await seeded()

    expect(await store.listTickets()).not.toHaveProperty('total')
  })
})

describe('walking a queue a page at a time', () => {
  it('hands every ticket over exactly once', async () => {
    const store = await seeded()
    const seen: string[] = []
    let cursor: string | undefined

    do {
      const page = await store.listTickets({ limit: 2, sortBy: 'created', order: 'asc', ...(cursor ? { cursor } : {}) })
      seen.push(...page.items.map((ticket) => ticket.subject))
      cursor = page.cursor
    } while (cursor)

    expect(seen).toEqual(['First opened', 'Second opened', 'Third opened'])
  })

  it('refuses a cursor from a different ordering rather than paging into nonsense', async () => {
    const store = await seeded()
    const first = await store.listTickets({ limit: 1, sortBy: 'created', order: 'asc' })

    await expect(store.listTickets({ limit: 1, cursor: first.cursor as string })).rejects.toThrow(/created asc/)
  })

  it('still takes a bare ticket number, for a cursor handed out before this existed', () => {
    expect(ticketCursorAt('42', orderingOf())).toBe(42)
    expect(() => ticketCursorAt('nonsense', orderingOf())).toThrow(/not a ticket cursor/)
  })

  it('round trips through the ordering it was issued for', () => {
    const ordering = orderingOf({ sortBy: 'lastMessage', order: 'asc' })

    expect(ticketCursorAt(ticketCursor(ordering, 7), ordering)).toBe(7)
  })
})

describe('the stores agreeing with each other', () => {
  it('honours a timestamp the caller supplied, wherever the tickets live', async () => {
    // The SQL stores already did. Stamping "now" in one and not another is how
    // the same queue comes back in a different order depending on where it is
    // kept, and an import knows when the thing actually happened.
    const store = memoryStore()
    const ticket = await store.createTicket({
      subject: 'Imported',
      description: 'From the old desk',
      statusId: 'new',
      statusCategory: 'new',
      customer: { email: 'sam@example.com' },
      channel: 'email',
      metadata: {},
      createdAt: '2019-06-01T00:00:00.000Z',
      updatedAt: '2019-06-01T00:00:00.000Z',
    })

    const updated = await store.updateTicket(ticket.ticketNumber, { updatedAt: '2019-06-01T00:00:00.000Z' })
    expect(updated?.updatedAt).toBe('2019-06-01T00:00:00.000Z')

    const touched = await store.updateTicket(ticket.ticketNumber, { subject: 'Renamed' })
    expect(touched?.updatedAt).not.toBe('2019-06-01T00:00:00.000Z')
  })
})
