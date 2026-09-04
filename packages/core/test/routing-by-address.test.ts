import { describe, expect, it } from 'vitest'
import { evaluateTriggers, routeTicket } from '../src/helpdesk/index.js'
import type { RoutingRule, Team, Ticket } from '../src/helpdesk/index.js'

/**
 * A named account, a handful of VIPs, the one reseller whose tickets go
 * straight to the person who knows them. A domain cannot say any of that.
 */

const teams: Team[] = [
  { id: 'support', name: 'Support', isDefault: true, members: [] },
  { id: 'accounts', name: 'Named accounts', isDefault: false, members: [] },
]

const ticket = (email?: string): Ticket => ({
  ticketNumber: 1,
  subject: 'Where is my order',
  description: 'It has been a week',
  statusId: 'new',
  statusCategory: 'new',
  customer: email ? { email } : {},
  channel: 'email',
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const rules: RoutingRule[] = [
  { name: 'Named accounts', teamId: 'accounts', when: { email: ['buyer@acme.example', 'ops@acme.example'] } },
]

describe('routing on a whole address', () => {
  it('sends a named account to its own team', () => {
    expect(routeTicket(ticket('buyer@acme.example'), rules, teams).teamId).toBe('accounts')
    expect(routeTicket(ticket('ops@acme.example'), rules, teams).teamId).toBe('accounts')
  })

  it('leaves everybody else on the default team', () => {
    // Including the same company, which is what makes this different from a
    // domain rule.
    expect(routeTicket(ticket('someone@acme.example'), rules, teams).teamId).toBe('support')
    expect(routeTicket(ticket(), rules, teams).teamId).toBe('support')
  })

  it('ignores case and stray spacing, since a list is typed by a person', () => {
    const typed: RoutingRule[] = [{ name: 'x', teamId: 'accounts', when: { email: ['  Buyer@ACME.example '] } }]
    expect(routeTicket(ticket('buyer@acme.example'), typed, teams).teamId).toBe('accounts')
  })
})

describe('a rule on a whole address', () => {
  it('works the same way in a trigger', () => {
    const fired = evaluateTriggers(
      ticket('buyer@acme.example'),
      [{ name: 'Flag the account', on: ['created'], when: { email: ['buyer@acme.example'] }, then: { addNote: 'VIP' } }],
      'created',
    )

    expect(fired.map((one) => one.name)).toEqual(['Flag the account'])
    expect(evaluateTriggers(ticket('other@acme.example'), [
      { name: 'Flag the account', on: ['created'], when: { email: ['buyer@acme.example'] }, then: { addNote: 'VIP' } },
    ], 'created')).toEqual([])
  })
})
