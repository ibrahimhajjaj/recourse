import { describe, expect, it } from 'vitest'
import { createHelpdesk, ticketStats } from '../src/helpdesk/index.js'
import type { Ticket, TicketMessage } from '../src/helpdesk/index.js'
import { memoryStore } from '../src/store/index.js'

/**
 * The numbers a support lead lives on, none of which is a field on a ticket:
 * how long somebody waited is the gap between what they said and what a person
 * said back.
 */

const minute = 60_000

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  ticketNumber: 1,
  subject: 'Kettle',
  description: 'Broken',
  statusId: 'new',
  statusCategory: 'new',
  customer: { email: 'sam@example.com' },
  channel: 'web',
  metadata: {},
  createdAt: '2026-01-01T09:00:00.000Z',
  updatedAt: '2026-01-01T09:00:00.000Z',
  ...over,
})

const message = (over: Partial<TicketMessage> & { createdAt: string }): TicketMessage => ({
  id: `m${Math.random()}`,
  ticketNumber: 1,
  type: 'reply',
  sender: { type: 'agent' },
  content: 'x',
  ...over,
})

describe('how long a customer waits', () => {
  it('measures the first reply from when the ticket was opened', () => {
    const stats = ticketStats(
      [ticket()],
      new Map([[1, [message({ createdAt: '2026-01-01T09:20:00.000Z' })]]]),
    )

    expect(stats.medianFirstReplyMs).toBe(20 * minute)
  })

  it('does not count a note or a status event as an answer', () => {
    // A note is written between colleagues and an event is the software
    // talking to itself. Counting either says the customer was answered when
    // nobody has spoken to them.
    const stats = ticketStats(
      [ticket()],
      new Map([
        [
          1,
          [
            message({ createdAt: '2026-01-01T09:05:00.000Z', type: 'note' }),
            message({ createdAt: '2026-01-01T09:10:00.000Z', type: 'event', sender: { type: 'system' } }),
            message({ createdAt: '2026-01-01T09:30:00.000Z' }),
          ],
        ],
      ]),
    )

    expect(stats.medianFirstReplyMs).toBe(30 * minute)
  })

  it('restarts the clock when the customer says something else', () => {
    // What is being measured is how long somebody waits after speaking, not
    // how long since the ticket opened.
    const stats = ticketStats(
      [ticket()],
      new Map([
        [
          1,
          [
            message({ createdAt: '2026-01-01T09:10:00.000Z' }),
            message({ createdAt: '2026-01-01T11:00:00.000Z', sender: { type: 'customer' } }),
            message({ createdAt: '2026-01-01T11:05:00.000Z' }),
          ],
        ],
      ]),
    )

    expect(stats.medianFirstReplyMs).toBe(10 * minute)
    // Ten minutes and five minutes.
    expect(stats.medianReplyMs).toBe(7.5 * minute)
  })

  it('says nothing rather than zero when nobody has replied', () => {
    // Zero is a real answer here, meaning somebody replied instantly.
    const stats = ticketStats([ticket()], new Map())

    expect(stats).not.toHaveProperty('medianFirstReplyMs')
    expect(stats.created).toBe(1)
  })

  it('takes the middle, so one ticket over a bank holiday does not move it', () => {
    const tickets = [1, 2, 3].map((ticketNumber) => ticket({ ticketNumber }))
    const threads = new Map([
      [1, [message({ ticketNumber: 1, createdAt: '2026-01-01T09:10:00.000Z' })]],
      [2, [message({ ticketNumber: 2, createdAt: '2026-01-01T09:20:00.000Z' })]],
      [3, [message({ ticketNumber: 3, createdAt: '2026-01-04T09:00:00.000Z' })]],
    ])

    expect(ticketStats(tickets, threads).medianFirstReplyMs).toBe(20 * minute)
  })
})

describe('how long a ticket stays open', () => {
  it('measures to the status event, not to whenever it was last touched', () => {
    // A ticket closed in an hour and edited a week later took an hour.
    const closed = ticket({
      statusCategory: 'closed',
      statusId: 'closed',
      updatedAt: '2026-01-08T09:00:00.000Z',
    })

    const stats = ticketStats(
      [closed],
      new Map([
        [
          1,
          [
            message({
              createdAt: '2026-01-01T10:00:00.000Z',
              type: 'event',
              sender: { type: 'system' },
              metadata: { event: 'status', from: 'new', to: 'closed' },
            }),
          ],
        ],
      ]),
    )

    expect(stats.medianTimeToCloseMs).toBe(60 * minute)
  })

  it('counts the last close, for a ticket that came back', () => {
    const closed = ticket({ statusCategory: 'closed', statusId: 'closed' })
    const event = (createdAt: string) =>
      message({ createdAt, type: 'event', sender: { type: 'system' }, metadata: { event: 'status' } })

    const stats = ticketStats(
      [closed],
      new Map([[1, [event('2026-01-01T10:00:00.000Z'), event('2026-01-01T12:00:00.000Z')]]]),
    )

    expect(stats.medianTimeToCloseMs).toBe(180 * minute)
  })

  it('ignores a ticket that is still open', () => {
    expect(ticketStats([ticket()], new Map())).not.toHaveProperty('medianTimeToCloseMs')
  })
})

describe('the shape of the queue', () => {
  it('counts what is done, what is left, and where it came from', () => {
    const stats = ticketStats(
      [
        ticket({ ticketNumber: 1, channel: 'email', statusCategory: 'closed' }),
        ticket({ ticketNumber: 2, channel: 'email' }),
        ticket({ ticketNumber: 3, channel: 'whatsapp', statusCategory: 'cancelled' }),
      ],
      new Map(),
    )

    expect(stats).toMatchObject({
      created: 3,
      solved: 2,
      unsolved: 1,
      byChannel: { email: 2, whatsapp: 1 },
      byStatusCategory: { closed: 1, new: 1, cancelled: 1 },
    })
  })
})

describe('reading them off a live desk', () => {
  it('assembles the threads itself', async () => {
    const desk = createHelpdesk({
      store: memoryStore(),
      teams: [{ id: 'support', name: 'Support', isDefault: true, members: ['ana@shop.example'] }],
    })

    const opened = await desk.openTicket({
      subject: 'Kettle',
      description: 'Broken',
      customer: { email: 'sam@example.com' },
      channel: 'web',
    })
    await desk.reply(opened.ticketNumber, 'On its way.', { type: 'agent', id: 'ana@shop.example' })

    const stats = await desk.stats()
    expect(stats.created).toBe(1)
    expect(stats.unsolved).toBe(1)
    expect(stats.medianFirstReplyMs).toBeGreaterThanOrEqual(0)
  })
})
