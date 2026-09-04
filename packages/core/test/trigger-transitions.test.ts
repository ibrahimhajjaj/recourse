import { describe, expect, it } from 'vitest'
import { createHelpdesk, evaluateTriggers } from '../src/helpdesk/index.js'
import type { Ticket, Trigger } from '../src/helpdesk/index.js'
import { memoryStore } from '../src/store/index.js'

/**
 * Rules about what moved, rather than about what a ticket is.
 *
 * A closed ticket looks identical whether it was closed a moment ago or last
 * week, and an unassigned one looks identical whether somebody just dropped it
 * or nobody ever picked it up. Both of the rules a desk actually wants are
 * about the transition.
 */

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  ticketNumber: 1,
  subject: 'Kettle arrived broken',
  description: 'It was cracked',
  statusId: 'new',
  statusCategory: 'new',
  customer: { email: 'sam@example.com' },
  channel: 'web',
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const fires = (when: Trigger['when'], now: Ticket, before?: Ticket) =>
  evaluateTriggers(now, [{ name: 'rule', on: ['updated'], when, then: { addNote: 'x' } }], 'updated', before).length > 0

describe('a rule about a transition', () => {
  it('matches a reopen and not a ticket that was already open', () => {
    const when = { changed: { statusCategory: { from: 'closed' as const } } }

    expect(fires(when, ticket({ statusCategory: 'new' }), ticket({ statusCategory: 'closed' }))).toBe(true)
    expect(fires(when, ticket({ statusCategory: 'new' }), ticket({ statusCategory: 'on_you' }))).toBe(false)
  })

  it('matches a ticket dropped back in the queue', () => {
    const when = { changed: { assigneeId: { to: null } } }

    expect(fires(when, ticket(), ticket({ assigneeId: 'ana' }))).toBe(true)
    // Never picked up in the first place is a different thing, and no move.
    expect(fires(when, ticket(), ticket())).toBe(false)
  })

  it('matches any move at all when asked for one', () => {
    expect(fires({ changed: { teamId: true } }, ticket({ teamId: 'billing' }), ticket({ teamId: 'support' }))).toBe(true)
    expect(fires({ changed: { teamId: true } }, ticket({ teamId: 'support' }), ticket({ teamId: 'support' }))).toBe(
      false,
    )
  })

  it('needs both ends when both were named', () => {
    const when = { changed: { statusCategory: { from: 'closed' as const, to: 'on_you' as const } } }

    expect(fires(when, ticket({ statusCategory: 'on_you' }), ticket({ statusCategory: 'closed' }))).toBe(true)
    expect(fires(when, ticket({ statusCategory: 'new' }), ticket({ statusCategory: 'closed' }))).toBe(false)
  })

  it('never fires without a before-picture', () => {
    // A create has none, and a caller that did not supply one is not entitled
    // to a reopen rule firing on every ticket it saves.
    expect(fires({ changed: { statusCategory: true } }, ticket({ statusCategory: 'new' }))).toBe(false)
  })
})

describe('rules written for an update', () => {
  it('actually run when a ticket is updated', async () => {
    // They used to be configuration that did nothing: triggers were only
    // evaluated on creation, so a desk watched its reopen rule never fire and
    // had nothing to read that said why.
    const store = memoryStore()
    const desk = createHelpdesk({
      store,
      teams: [{ id: 'support', name: 'Support', isDefault: true, members: ['ana@shop.example'] }],
      triggers: [
        {
          name: 'Back in the queue when reopened',
          on: ['updated'],
          when: { changed: { statusCategory: { from: 'closed' } } },
          then: { setAssigneeId: null, addNote: 'Reopened, so back in the queue.' },
        },
      ],
    })

    const opened = await desk.openTicket({
      subject: 'Kettle arrived broken',
      description: 'It was cracked',
      customer: { email: 'sam@example.com' },
      channel: 'web',
    })

    await desk.update(opened.ticketNumber, { assigneeId: 'ana@shop.example', statusCategory: 'closed' })
    const reopened = await desk.update(opened.ticketNumber, { statusCategory: 'on_you' })

    expect(reopened?.assigneeId).toBeUndefined()

    const thread = await desk.listMessages(opened.ticketNumber)
    expect(thread.items.some((message) => message.content.includes('back in the queue'))).toBe(true)
  })

  it('leaves an ordinary update alone', async () => {
    const store = memoryStore()
    const desk = createHelpdesk({
      store,
      teams: [{ id: 'support', name: 'Support', isDefault: true, members: ['ana@shop.example'] }],
      triggers: [
        {
          name: 'Back in the queue when reopened',
          on: ['updated'],
          when: { changed: { statusCategory: { from: 'closed' } } },
          then: { setAssigneeId: null },
        },
      ],
    })

    const opened = await desk.openTicket({
      subject: 'Kettle arrived broken',
      description: 'It was cracked',
      customer: { email: 'sam@example.com' },
      channel: 'web',
    })

    const assigned = await desk.update(opened.ticketNumber, { assigneeId: 'ana@shop.example' })
    expect(assigned?.assigneeId).toBe('ana@shop.example')
  })
})
