import { describe, expect, it } from 'vitest'
import { citedOnly } from '../src/agent.js'
import { thresholdFor } from '../src/safety/types.js'
import { evaluateTriggers, defaultViews } from '../src/helpdesk/triggers.js'
import type { SourceRef } from '../src/types.js'
import type { Ticket } from '../src/helpdesk/types.js'

/**
 * Public functions with real branching that no test named.
 *
 * They are reached indirectly, which is not the same as covered: an indirect
 * path exercises the case the caller happens to take, and the interesting
 * behaviour of each of these is at an edge no caller reaches on a good day.
 */

const sources: SourceRef[] = [
  { id: 'a', title: 'Refunds' },
  { id: 'b', title: 'Shipping' },
  { id: 'c', title: 'Returns' },
]

describe('narrowing sources to what the answer cited', () => {
  it('keeps only the ones actually referenced', () => {
    expect(citedOnly(sources, 'We refund within 30 days [1], and post next day [2].')).toEqual([
      sources[0],
      sources[1],
    ])
  })

  it('reads the markers as one-indexed, the way the prompt asks for them', () => {
    expect(citedOnly(sources, 'See [3].')).toEqual([sources[2]])
  })

  it('takes each source once however often it is cited', () => {
    expect(citedOnly(sources, '[1] and again [1] and [1]')).toEqual([sources[0]])
  })

  // Retrieval over-fetches on purpose, so an uncited answer still has a source
  // list worth showing. Showing nothing would be worse than showing what it read.
  it('falls back to everything retrieved when the answer cited nothing', () => {
    expect(citedOnly(sources, 'I am not sure about that one.')).toEqual(sources)
  })

  // The sharp edge. A model that invents [7] against three sources produces the
  // same result as citing nothing, so every source is listed as though used.
  // Worth knowing rather than discovering: the fallback cannot tell an
  // uncited answer from a wrongly cited one.
  it('falls back the same way when the citation is out of range', () => {
    expect(citedOnly(sources, 'As set out in [7].')).toEqual(sources)
  })

  it('handles an empty source list without inventing one', () => {
    expect(citedOnly([], 'Nothing to cite [1].')).toEqual([])
  })
})

describe('the sensitivity dial', () => {
  it('reads an explicit threshold over the named one', () => {
    expect(thresholdFor({ name: 'injection', threshold: 0.42, sensitivity: 'high' })).toBe(0.42)
  })

  it('falls to medium when nothing is said, rather than to the strictest', () => {
    const unset = thresholdFor({ name: 'injection' })
    expect(unset).toBe(thresholdFor({ name: 'injection', sensitivity: 'medium' }))
  })

  // A higher sensitivity has to mean a lower bar, or the dial is backwards and
  // turning it up would quietly refuse less.
  it('lowers the bar as sensitivity rises', () => {
    const low = thresholdFor({ name: 'x', sensitivity: 'low' })
    const medium = thresholdFor({ name: 'x', sensitivity: 'medium' })
    const high = thresholdFor({ name: 'x', sensitivity: 'high' })
    expect(low).toBeGreaterThan(medium)
    expect(medium).toBeGreaterThan(high)
  })
})

describe('help desk triggers', () => {
  const ticket = {
    subject: 'Charged twice for one order',
    description: 'My card shows two payments for order 4471.',
    statusCategory: 'new',
  } as Ticket

  it('fires only on the event it was asked about', () => {
    const trigger = {
      name: 'Billing',
      on: ['created' as const],
      when: { contains: ['charged'] },
      then: { assignTeam: 'billing' },
    }

    expect(evaluateTriggers(ticket, [trigger], 'created')).toEqual([
      { name: 'Billing', action: { assignTeam: 'billing' } },
    ])
    expect(evaluateTriggers(ticket, [trigger], 'updated')).toEqual([])
  })

  it('matches the subject and the description together, and ignores case', () => {
    const inDescription = { name: 'a', on: ['created' as const], when: { contains: ['ORDER 4471'] }, then: {} }
    expect(evaluateTriggers(ticket, [inDescription], 'created')).toHaveLength(1)
  })

  // Every condition has to hold. An or would fire a billing rule on any new
  // ticket, which is how an inbox ends up routed entirely to one team.
  it('requires every condition, not any of them', () => {
    const both = {
      name: 'both',
      on: ['created' as const],
      when: { contains: ['charged'], statusCategory: 'closed' as const },
      then: {},
    }
    expect(evaluateTriggers(ticket, [both], 'created')).toEqual([])
  })

  it('fires every trigger that matches, not just the first', () => {
    const two = [
      { name: 'one', on: ['created' as const], when: { contains: ['charged'] }, then: {} },
      { name: 'two', on: ['created' as const], when: { contains: ['payments'] }, then: {} },
    ]
    expect(evaluateTriggers(ticket, two, 'created').map((f) => f.name)).toEqual(['one', 'two'])
  })

  it('ships views that are usable rather than empty', () => {
    const views = defaultViews()
    expect(views.length).toBeGreaterThan(0)
    expect(views.every((view) => view.name && view.filter)).toBe(true)
  })
})
