import type { Ticket } from './types.js'

/**
 * Who picks the ticket up.
 *
 * `least_busy` is the default because round robin ignores that one agent is
 * sitting on eight open tickets while another has none: it distributes arrivals
 * evenly, not work. Set `manual` when a team would rather pull than be pushed.
 */
export type AssignmentAlgorithm = 'least_busy' | 'round_robin' | 'manual'

export interface Availability {
  /** Agent id or email. */
  id: string
  /** Off shift, on holiday, or at capacity. */
  available: boolean
  /** Tickets currently open on them. */
  openTickets: number
}

export interface AssignOptions {
  algorithm?: AssignmentAlgorithm
  candidates: Availability[]
  /** Used by round robin to continue where the last assignment left off. */
  lastAssignedId?: string
}

/** Returns the agent to assign to, or undefined to leave it unassigned. */
export function assignTicket(options: AssignOptions): string | undefined {
  const algorithm = options.algorithm ?? 'least_busy'
  if (algorithm === 'manual') return undefined

  const available = options.candidates.filter((candidate) => candidate.available)
  if (available.length === 0) return undefined

  if (algorithm === 'round_robin') {
    const order = [...available].sort((a, b) => a.id.localeCompare(b.id))
    const previous = order.findIndex((candidate) => candidate.id === options.lastAssignedId)
    // Wraps naturally when the previous assignee is gone or was last in line.
    return order[(previous + 1) % order.length]?.id
  }

  return [...available].sort(
    (a, b) => a.openTickets - b.openTickets || a.id.localeCompare(b.id),
  )[0]?.id
}

/** Counts what each candidate currently has open, for `least_busy`. */
export function loadOf(tickets: Ticket[], ids: string[]): Availability[] {
  const counts = new Map<string, number>()
  for (const ticket of tickets) {
    if (!ticket.assigneeId) continue
    counts.set(ticket.assigneeId, (counts.get(ticket.assigneeId) ?? 0) + 1)
  }
  return ids.map((id) => ({ id, available: true, openTickets: counts.get(id) ?? 0 }))
}
