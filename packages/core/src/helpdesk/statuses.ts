import type { StatusCategory, TicketStatus } from './types.js'

/**
 * A workable status set out of the box.
 *
 * Configuring statuses before you can take a single ticket is a bad first five
 * minutes, and most teams end up with roughly this anyway. Replace it wholesale
 * when you know what your team actually needs.
 */
export const DEFAULT_STATUSES: TicketStatus[] = [
  { id: 'new', category: 'new', externalLabel: 'Received', internalLabel: 'New', color: '#2563eb', isDefault: true, position: 1 },
  { id: 'open', category: 'on_you', externalLabel: 'In progress', internalLabel: 'On us', color: '#a4551f', isDefault: true, position: 2 },
  { id: 'waiting', category: 'on_customer', externalLabel: 'Waiting for you', internalLabel: 'On the customer', color: '#7c3aed', isDefault: true, position: 3 },
  { id: 'hold', category: 'on_hold', externalLabel: 'On hold', internalLabel: 'On hold', color: '#6b7280', isDefault: true, position: 4 },
  { id: 'closed', category: 'closed', externalLabel: 'Resolved', internalLabel: 'Closed', color: '#16a34a', isDefault: true, position: 5 },
  { id: 'cancelled', category: 'cancelled', externalLabel: 'Cancelled', internalLabel: 'Cancelled', color: '#9ca3af', isDefault: true, position: 6 },
]

/** The status a ticket moves to when it enters a category, honouring isDefault. */
export function defaultStatusFor(
  category: StatusCategory,
  statuses: TicketStatus[] = DEFAULT_STATUSES,
): TicketStatus | undefined {
  const inCategory = statuses.filter((status) => status.category === category)
  return inCategory.find((status) => status.isDefault) ?? inCategory[0]
}

/**
 * Checks the one invariant the rest of the code relies on: every category a
 * ticket can be moved into has somewhere to land.
 */
export function validateStatuses(statuses: TicketStatus[]): void {
  if (statuses.length === 0) throw new Error('a help desk needs at least one status')

  const seen = new Set<string>()
  for (const status of statuses) {
    if (seen.has(status.id)) throw new Error(`duplicate status id "${status.id}"`)
    seen.add(status.id)
  }

  for (const category of ['new', 'on_you', 'closed'] as const) {
    if (!statuses.some((status) => status.category === category)) {
      throw new Error(`no status in the "${category}" category; a ticket could never reach it`)
    }
  }
}
