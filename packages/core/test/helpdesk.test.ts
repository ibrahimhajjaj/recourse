import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHelpdesk, assignTicket, defaultStatusFor, loadOf, routeTicket, validateStatuses, DEFAULT_STATUSES } from '../src/helpdesk/index.js'
import type { RoutingRule, Team, Ticket } from '../src/helpdesk/index.js'
import { fileStore, memoryStore } from '../src/store/index.js'
import { escalate } from '../src/actions/index.js'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const TEAMS: Team[] = [
  { id: 'support', name: 'Support', isDefault: true, members: ['ana@shop.example', 'ben@shop.example'] },
  { id: 'billing', name: 'Billing', isDefault: false, members: ['cat@shop.example'] },
  { id: 'wholesale', name: 'Wholesale', isDefault: false, members: [] },
]

const ROUTING: RoutingRule[] = [
  { name: 'Billing disputes', teamId: 'billing', when: { contains: ['refund', 'charged', 'invoice'] } },
  { name: 'Trade accounts', teamId: 'wholesale', when: { emailDomain: ['cafe.example'] } },
]

function helpdesk(overrides: Partial<Parameters<typeof createHelpdesk>[0]> = {}) {
  return createHelpdesk({ store: memoryStore(), teams: TEAMS, routing: ROUTING, ...overrides })
}

describe('statuses', () => {
  it('ships a default for every category a ticket can reach', () => {
    expect(() => validateStatuses(DEFAULT_STATUSES)).not.toThrow()
    expect(defaultStatusFor('closed')?.id).toBe('closed')
  })

  it('refuses a set with no way to open a ticket', () => {
    expect(() => validateStatuses([{ id: 'x', category: 'on_hold', externalLabel: 'x', internalLabel: 'x', isDefault: true, position: 1 }])).toThrow(
      /"new" category/,
    )
  })

  it('refuses duplicate ids, which would make status changes ambiguous', () => {
    const dupe = [...DEFAULT_STATUSES, DEFAULT_STATUSES[0]!]
    expect(() => validateStatuses(dupe)).toThrow(/duplicate status/)
  })
})

describe('routing', () => {
  function ticket(overrides: Partial<Ticket> = {}): Ticket {
    return {
      ticketNumber: 1,
      subject: 'Help',
      description: 'Something happened',
      statusId: 'new',
      statusCategory: 'new',
      customer: {},
      channel: 'web',
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('sends a refund question to billing', () => {
    const routed = routeTicket(ticket({ subject: 'I was charged twice' }), ROUTING, TEAMS)
    expect(routed).toEqual({ teamId: 'billing', rule: 'Billing disputes' })
  })

  it('matches on the customer email domain', () => {
    const routed = routeTicket(ticket({ customer: { email: 'buyer@cafe.example' } }), ROUTING, TEAMS)
    expect(routed.teamId).toBe('wholesale')
  })

  it('takes the first matching rule, not the best one', () => {
    // Matches both rules; billing is listed first, so billing wins.
    const routed = routeTicket(
      ticket({ subject: 'refund please', customer: { email: 'buyer@cafe.example' } }),
      ROUTING,
      TEAMS,
    )
    expect(routed.rule).toBe('Billing disputes')
  })

  it('falls back to the default team when nothing matches', () => {
    const routed = routeTicket(ticket({ subject: 'What grind for a V60?' }), ROUTING, TEAMS)
    expect(routed).toEqual({ teamId: 'support', rule: undefined })
  })

  it('supports a custom predicate for anything the fields cannot express', () => {
    const rules: RoutingRule[] = [
      { name: 'VIP', teamId: 'billing', when: { custom: (t) => t.metadata.vip === true } },
    ]
    expect(routeTicket(ticket({ metadata: { vip: true } }), rules, TEAMS).teamId).toBe('billing')
  })
})

describe('assignment', () => {
  const candidates = [
    { id: 'ana', available: true, openTickets: 5 },
    { id: 'ben', available: true, openTickets: 1 },
    { id: 'cat', available: false, openTickets: 0 },
  ]

  it('gives the ticket to whoever has least on, not whoever is next', () => {
    expect(assignTicket({ candidates })).toBe('ben')
  })

  it('never assigns to someone unavailable, even if they are idle', () => {
    expect(assignTicket({ candidates })).not.toBe('cat')
  })

  it('rotates in order with round robin', () => {
    const available = candidates.filter((c) => c.available)
    expect(assignTicket({ algorithm: 'round_robin', candidates: available, lastAssignedId: 'ana' })).toBe('ben')
    expect(assignTicket({ algorithm: 'round_robin', candidates: available, lastAssignedId: 'ben' })).toBe('ana')
  })

  it('leaves it unassigned when the team pulls rather than being pushed', () => {
    expect(assignTicket({ algorithm: 'manual', candidates })).toBeUndefined()
  })

  it('leaves it unassigned when nobody is available', () => {
    expect(assignTicket({ candidates: [{ id: 'x', available: false, openTickets: 0 }] })).toBeUndefined()
  })

  it('counts current load from the open tickets', () => {
    const open = [
      { assigneeId: 'ana' },
      { assigneeId: 'ana' },
      { assigneeId: 'ben' },
    ] as Ticket[]
    expect(loadOf(open, ['ana', 'ben', 'cat'])).toEqual([
      { id: 'ana', available: true, openTickets: 2 },
      { id: 'ben', available: true, openTickets: 1 },
      { id: 'cat', available: true, openTickets: 0 },
    ])
  })
})

describe('opening a ticket', () => {
  it('numbers tickets sequentially so a customer can quote one', async () => {
    const desk = helpdesk()
    const first = await desk.openTicket({ subject: 'a', description: 'b', customer: {} })
    const second = await desk.openTicket({ subject: 'c', description: 'd', customer: {} })
    expect([first.ticketNumber, second.ticketNumber]).toEqual([1, 2])
  })

  it('routes and assigns in one step', async () => {
    const desk = helpdesk()
    const ticket = await desk.openTicket({
      subject: 'I was charged twice this month',
      description: 'Two payments came out.',
      customer: { email: 'sam@example.com' },
    })
    expect(ticket.teamId).toBe('billing')
    expect(ticket.assigneeId).toBe('cat@shop.example')
    expect(ticket.statusCategory).toBe('new')
  })

  it('leaves it unassigned when the routed team has nobody on it', async () => {
    const desk = helpdesk()
    const ticket = await desk.openTicket({
      subject: 'trade pricing',
      description: 'x',
      customer: { email: 'buyer@cafe.example' },
    })
    expect(ticket.teamId).toBe('wholesale')
    expect(ticket.assigneeId).toBeUndefined()
  })

  it('records why it was routed, so the decision is auditable', async () => {
    const desk = helpdesk()
    const ticket = await desk.openTicket({ subject: 'refund', description: 'x', customer: {} })
    const thread = await desk.listMessages(ticket.ticketNumber)
    expect(thread.items[0]?.type).toBe('event')
    expect(thread.items[0]?.content).toContain('Billing disputes')
  })

  it('tells the host so it can send the email or page someone', async () => {
    const opened: number[] = []
    const desk = helpdesk({ onTicketOpened: (ticket) => void opened.push(ticket.ticketNumber) })
    await desk.openTicket({ subject: 'a', description: 'b', customer: {} })
    expect(opened).toEqual([1])
  })
})

describe('working a ticket', () => {
  it('moves to the customer when an agent replies', async () => {
    const desk = helpdesk()
    const ticket = await desk.openTicket({ subject: 'a', description: 'b', customer: {} })
    await desk.reply(ticket.ticketNumber, 'We have refunded you.', { type: 'agent', name: 'Ana' })

    expect((await desk.getTicket(ticket.ticketNumber))?.statusCategory).toBe('on_customer')
  })

  it('comes back to us when the customer replies', async () => {
    const desk = helpdesk()
    const ticket = await desk.openTicket({ subject: 'a', description: 'b', customer: {} })
    await desk.reply(ticket.ticketNumber, 'Thanks, but it is still wrong.', { type: 'customer' })

    expect((await desk.getTicket(ticket.ticketNumber))?.statusCategory).toBe('on_you')
  })

  it('does not change whose move it is when someone adds a note', async () => {
    const desk = helpdesk()
    const ticket = await desk.openTicket({ subject: 'a', description: 'b', customer: {} })
    await desk.note(ticket.ticketNumber, 'Checked with the roastery.', { type: 'agent', name: 'Ana' })

    expect((await desk.getTicket(ticket.ticketNumber))?.statusCategory).toBe('new')
  })

  it('logs a status change as an event on the thread', async () => {
    const desk = helpdesk()
    const ticket = await desk.openTicket({ subject: 'a', description: 'b', customer: {} })
    await desk.update(ticket.ticketNumber, { statusCategory: 'closed' })

    const thread = await desk.listMessages(ticket.ticketNumber)
    expect(thread.items.some((m) => m.content.includes('Status changed to Closed'))).toBe(true)
  })

  it('refuses a status that does not exist', async () => {
    const desk = helpdesk()
    const ticket = await desk.openTicket({ subject: 'a', description: 'b', customer: {} })
    await expect(desk.update(ticket.ticketNumber, { statusId: 'invented' })).rejects.toThrow(/unknown status/)
  })

  it('returns null for a ticket that is not there', async () => {
    expect(await helpdesk().update(999, { statusCategory: 'closed' })).toBeNull()
  })
})

describe('finding tickets', () => {
  async function seeded() {
    const desk = helpdesk()
    await desk.openTicket({ subject: 'Refund for order LUM-1', description: 'charged twice', customer: {} })
    await desk.openTicket({ subject: 'Grind advice', description: 'for a French press', customer: {} })
    const third = await desk.openTicket({ subject: 'Damaged bag', description: 'arrived split', customer: {} })
    await desk.update(third.ticketNumber, { statusCategory: 'closed' })
    return desk
  }

  it('shows only what is still open when a queue asks for open work', async () => {
    const page = await (await seeded()).listTickets({ openOnly: true })
    expect(page.items.map((t) => t.subject)).not.toContain('Damaged bag')
    expect(page.items).toHaveLength(2)
  })

  it('filters by team', async () => {
    const page = await (await seeded()).listTickets({ teamId: 'billing' })
    expect(page.items).toHaveLength(1)
  })

  it('filters for unassigned work', async () => {
    const page = await (await seeded()).listTickets({ assigneeId: null })
    expect(page.items.every((t) => !t.assigneeId)).toBe(true)
  })

  it('searches subjects, descriptions and the thread', async () => {
    const desk = await seeded()
    expect((await desk.searchTickets('charged twice')).map((t) => t.ticketNumber)).toEqual([1])
    expect(await desk.searchTickets('french press')).toHaveLength(1)
  })

  it('returns nothing rather than everything for an empty search', async () => {
    expect(await (await seeded()).searchTickets('   ')).toEqual([])
  })
})

describe('tickets survive a restart', () => {
  it('reads back the ticket, its thread and the next number', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'recourse-hd-'))
    dirs.push(dir)

    const first = createHelpdesk({ store: fileStore({ dir }), teams: TEAMS, routing: ROUTING })
    const ticket = await first.openTicket({ subject: 'Refund please', description: 'charged twice', customer: {} })
    await first.reply(ticket.ticketNumber, 'Looking into it.', { type: 'agent', name: 'Ana' })

    const second = createHelpdesk({ store: fileStore({ dir }), teams: TEAMS, routing: ROUTING })
    const reloaded = await second.getTicket(ticket.ticketNumber)

    expect(reloaded?.subject).toBe('Refund please')
    expect(reloaded?.statusCategory).toBe('on_customer')
    expect((await second.listMessages(ticket.ticketNumber)).items.length).toBeGreaterThanOrEqual(2)

    // Numbering must not restart, or two tickets would share a number.
    const next = await second.openTicket({ subject: 'Another', description: 'x', customer: {} })
    expect(next.ticketNumber).toBe(ticket.ticketNumber + 1)
  })
})

describe('the escalate action opening a real ticket', () => {
  it('opens on the help desk and hands back the number', async () => {
    const desk = helpdesk()
    const action = escalate({ helpdesk: desk })

    const result = (await action.execute?.(
      { subject: 'I was charged twice', body: 'Two payments left my account.', email: 'sam@example.com' },
      { emit: () => {}, conversationId: 'c1' },
    )) as { ticketId?: string }

    expect(result.ticketId).toBe('1')

    const ticket = await desk.getTicket(1)
    expect(ticket?.teamId).toBe('billing')
    expect(ticket?.conversationId).toBe('c1')
    expect(ticket?.customer.email).toBe('sam@example.com')
  })

  it('refuses to be configured with nowhere to send the ticket', async () => {
    const action = escalate({})
    await expect(action.execute?.({ subject: 'a', body: 'b' }, { emit: () => {} })).rejects.toThrow(
      /helpdesk or a createTicket/,
    )
  })
})

describe('triggers', () => {
  const triggers = [
    {
      name: 'Flag wholesale',
      on: ['created' as const],
      when: { emailDomain: ['cafe.example'] },
      then: { setMetadata: { wholesale: true }, addNote: 'Trade customer, check pricing tier.' },
    },
    {
      name: 'Park delivery strikes',
      on: ['created' as const],
      when: { contains: ['strike'] },
      then: { setStatusCategory: 'on_hold' as const },
    },
  ]

  it('tags a ticket and leaves a note explaining why', async () => {
    const desk = createHelpdesk({ store: memoryStore(), teams: TEAMS, triggers })
    const ticket = await desk.openTicket({
      subject: 'Trade pricing',
      description: 'x',
      customer: { email: 'buyer@cafe.example' },
    })

    expect(ticket.metadata.wholesale).toBe(true)
    const thread = await desk.listMessages(ticket.ticketNumber)
    expect(thread.items.some((m) => m.content.includes('Trade customer'))).toBe(true)
  })

  it('moves a ticket to a different status', async () => {
    const desk = createHelpdesk({ store: memoryStore(), teams: TEAMS, triggers })
    const ticket = await desk.openTicket({
      subject: 'Where is my order',
      description: 'I heard there is a courier strike',
      customer: {},
    })
    expect(ticket.statusCategory).toBe('on_hold')
  })

  it('runs every matching rule, not just the first', async () => {
    const desk = createHelpdesk({ store: memoryStore(), teams: TEAMS, triggers })
    const ticket = await desk.openTicket({
      subject: 'Trade order delayed by the strike',
      description: 'x',
      customer: { email: 'buyer@cafe.example' },
    })
    expect(ticket.metadata.wholesale).toBe(true)
    expect(ticket.statusCategory).toBe('on_hold')
  })

  it('leaves a ticket alone when nothing matches', async () => {
    const desk = createHelpdesk({ store: memoryStore(), teams: TEAMS, triggers })
    const ticket = await desk.openTicket({ subject: 'Grind advice', description: 'x', customer: {} })
    expect(ticket.statusCategory).toBe('new')
    expect(ticket.metadata).toEqual({})
  })
})

describe('saved views', () => {
  it('ships the queues every team builds anyway', async () => {
    const desk = createHelpdesk({ store: memoryStore(), teams: TEAMS })
    expect(desk.views().map((view) => view.id)).toEqual(['unassigned', 'on-us', 'on-hold'])
  })

  it('runs a view as a queue', async () => {
    const desk = createHelpdesk({ store: memoryStore(), teams: TEAMS })
    await desk.openTicket({ subject: 'a', description: 'b', customer: {}, teamId: 'wholesale' })
    await desk.openTicket({ subject: 'c', description: 'd', customer: {} })

    const unassigned = await desk.runView('unassigned')
    expect(unassigned.items.every((ticket) => !ticket.assigneeId)).toBe(true)
    expect(unassigned.items).toHaveLength(1)
  })

  it('refuses a view that does not exist', async () => {
    const desk = createHelpdesk({ store: memoryStore(), teams: TEAMS })
    await expect(desk.runView('invented')).rejects.toThrow(/no saved view/)
  })
})

describe('AI draft replies', () => {
  it('drafts from the ticket thread without sending anything', async () => {
    const { MockLanguageModelV4 } = await import('ai/test')
    const { simulateReadableStream } = await import('ai')
    const { createAgent } = await import('../src/agent.js')
    const { buildIndex } = await import('../src/knowledge/build.js')
    const { textSource } = await import('../src/sources/text.js')

    const index = await buildIndex({
      sources: [
        textSource([
          { id: 'refunds', title: 'Refunds', text: '# Refunds\n\nWe refund any order within 30 days.' },
        ]),
      ],
    })

    const agent = createAgent({
      index,
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: '0' },
              { type: 'text-delta' as const, id: '0', delta: 'You are inside the 30 day window [1].' },
              { type: 'text-end' as const, id: '0' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop', raw: 'stop' } as const,
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
            ],
            chunkDelayInMs: 0,
          }),
        }),
      }),
    })

    const store = memoryStore()
    const desk = createHelpdesk({ store, teams: TEAMS, agent })
    const ticket = await desk.openTicket({
      subject: 'Can I get a refund',
      description: 'I ordered two weeks ago and it is not for me.',
      customer: { email: 'sam@example.com' },
    })

    const draft = await desk.draftReply(ticket.ticketNumber)
    expect(draft?.text).toContain('30 day window')

    // Nothing was sent: the thread still has only the opening event.
    const thread = await desk.listMessages(ticket.ticketNumber)
    expect(thread.items.every((message) => message.type === 'event')).toBe(true)
    expect((await desk.getTicket(ticket.ticketNumber))?.statusCategory).toBe('new')
  })

  it('refuses to draft without an agent, rather than returning nothing', async () => {
    const desk = createHelpdesk({ store: memoryStore(), teams: TEAMS })
    await expect(desk.draftReply(1)).rejects.toThrow(/needs an agent/)
  })

  it('returns null for a ticket that is not there', async () => {
    const { createAgent } = await import('../src/agent.js')
    const { buildIndex } = await import('../src/knowledge/build.js')
    const { textSource } = await import('../src/sources/text.js')
    const index = await buildIndex({
      sources: [textSource([{ id: 'a', title: 'A', text: '# A\n\nSome content here for the index.' }])],
    })
    const desk = createHelpdesk({ store: memoryStore(), teams: TEAMS, agent: createAgent({ index }) })
    expect(await desk.draftReply(999)).toBeNull()
  })
})
