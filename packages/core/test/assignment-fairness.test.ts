import { describe, expect, it } from 'vitest'
import { assignTicket, createHelpdesk, loadOf } from '../src/helpdesk/index.js'
import { memoryStore } from '../src/store/index.js'
import type { Ticket } from '../src/helpdesk/index.js'

/**
 * Who gets the next ticket when the obvious answer is a tie.
 */

const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

describe('breaking a tie on load', () => {
  it('goes to whoever has waited longest, not whoever sorts first', () => {
    // Alphabetical order is invisible on any one assignment and unmistakable
    // over a month: `ana@` takes every tie there will ever be.
    const chosen = assignTicket({
      candidates: [
        { id: 'ana@shop.example', available: true, openTickets: 3, lastAssignedAt: at(1) },
        { id: 'zoe@shop.example', available: true, openTickets: 3, lastAssignedAt: at(9) },
      ],
    })

    expect(chosen).toBe('zoe@shop.example')
  })

  it('puts somebody who has never been assigned anything first', () => {
    const chosen = assignTicket({
      candidates: [
        { id: 'ana@shop.example', available: true, openTickets: 0, lastAssignedAt: at(1) },
        { id: 'new@shop.example', available: true, openTickets: 0 },
      ],
    })

    expect(chosen).toBe('new@shop.example')
  })

  it('still prefers the lighter load over the longer wait', () => {
    const chosen = assignTicket({
      candidates: [
        { id: 'ana@shop.example', available: true, openTickets: 1, lastAssignedAt: at(1) },
        { id: 'zoe@shop.example', available: true, openTickets: 8, lastAssignedAt: at(30) },
      ],
    })

    expect(chosen).toBe('ana@shop.example')
  })

  it('falls back to the id when nothing else separates them', () => {
    const chosen = assignTicket({
      candidates: [
        { id: 'zoe@shop.example', available: true, openTickets: 2 },
        { id: 'ana@shop.example', available: true, openTickets: 2 },
      ],
    })

    expect(chosen).toBe('ana@shop.example')
  })
})

describe('an agent who has enough on', () => {
  const busy = [
    { id: 'ana@shop.example', available: true, openTickets: 12 },
    { id: 'zoe@shop.example', available: true, openTickets: 4 },
  ]

  it('stops being handed more once they reach the limit', () => {
    expect(assignTicket({ candidates: busy, maxOpen: 10 })).toBe('zoe@shop.example')
  })

  it('is skipped by round robin too, which otherwise ignores load entirely', () => {
    const chosen = assignTicket({
      algorithm: 'round_robin',
      candidates: busy,
      lastAssignedId: 'zoe@shop.example',
      maxOpen: 10,
    })

    expect(chosen).toBe('zoe@shop.example')
  })

  it('leaves the ticket unassigned when everyone is at the limit', () => {
    // The honest outcome, and what the unassigned queue is for.
    expect(assignTicket({ candidates: busy, maxOpen: 2 })).toBeUndefined()
  })

  it('is unaffected when no limit was set', () => {
    expect(assignTicket({ candidates: busy })).toBe('zoe@shop.example')
  })
})

describe('reading the load off the tickets', () => {
  const ticket = (assigneeId: string, createdAt: string): Ticket => ({
    ticketNumber: 1,
    subject: 's',
    description: 'd',
    statusId: 'new',
    statusCategory: 'new',
    customer: {},
    channel: 'web',
    metadata: {},
    createdAt,
    updatedAt: createdAt,
    assigneeId,
  })

  it('counts what each has open and when each was last given one', () => {
    const load = loadOf(
      [
        ticket('ana@shop.example', '2026-01-01T00:00:00.000Z'),
        ticket('ana@shop.example', '2026-03-01T00:00:00.000Z'),
        ticket('zoe@shop.example', '2026-02-01T00:00:00.000Z'),
      ],
      ['ana@shop.example', 'zoe@shop.example', 'new@shop.example'],
    )

    expect(load[0]).toMatchObject({ openTickets: 2, lastAssignedAt: '2026-03-01T00:00:00.000Z' })
    expect(load[1]).toMatchObject({ openTickets: 1, lastAssignedAt: '2026-02-01T00:00:00.000Z' })
    expect(load[2]).toMatchObject({ openTickets: 0 })
    expect(load[2]).not.toHaveProperty('lastAssignedAt')
  })
})

describe('a team that works differently from the rest of the desk', () => {
  const open = async (desk: Awaited<ReturnType<typeof helpdeskWith>>, subject: string) =>
    desk.openTicket({ subject, description: subject, customer: { email: 'sam@example.com' }, channel: 'web' })

  async function helpdeskWith(teams: Parameters<typeof createHelpdesk>[0]['teams']) {
    return createHelpdesk({ store: memoryStore(), assignment: 'least_busy', teams })
  }

  it('picks its own tickets while the rest of the desk is automatic', async () => {
    // Two people on billing know each other's cases; ten on general support
    // would rather not think about it. One setting makes one of them wrong.
    const desk = await helpdeskWith([
      { id: 'support', name: 'Support', isDefault: true, members: ['ana@shop.example'] },
      { id: 'billing', name: 'Billing', isDefault: false, members: ['cat@shop.example'], assignment: 'manual' },
    ])

    const auto = await desk.openTicket({
      subject: 'Where is my order',
      description: 'x',
      customer: { email: 'sam@example.com' },
      channel: 'web',
    })
    expect(auto.assigneeId).toBe('ana@shop.example')

    const manual = await desk.openTicket({
      subject: 'Billing question',
      description: 'x',
      customer: { email: 'sam@example.com' },
      channel: 'web',
      teamId: 'billing',
    })
    expect(manual.assigneeId).toBeUndefined()

    void open
  })

  it('takes its own cap over the desk-wide one', async () => {
    const desk = createHelpdesk({
      store: memoryStore(),
      assignment: 'least_busy',
      maxOpenPerAgent: 50,
      teams: [{ id: 'support', name: 'Support', isDefault: true, members: ['ana@shop.example'], maxOpenPerAgent: 1 }],
    })

    const first = await desk.openTicket({
      subject: 'One',
      description: 'x',
      customer: { email: 'sam@example.com' },
      channel: 'web',
    })
    expect(first.assigneeId).toBe('ana@shop.example')

    const second = await desk.openTicket({
      subject: 'Two',
      description: 'x',
      customer: { email: 'sam@example.com' },
      channel: 'web',
    })
    expect(second.assigneeId).toBeUndefined()
  })
})
