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
  /**
   * When they were last handed a ticket, for breaking a tie fairly.
   *
   * Without it two agents on the same load are separated by their id, which
   * means the one whose email sorts first wins every tie there will ever be:
   * `ana@` takes them all and `zoe@` takes none. That is invisible on any one
   * assignment and unmistakable over a month.
   */
  lastAssignedAt?: string
}

export interface AssignOptions {
  algorithm?: AssignmentAlgorithm
  candidates: Availability[]
  /** Used by round robin to continue where the last assignment left off. */
  lastAssignedId?: string
  /**
   * How many open tickets one agent may hold before they stop being given more.
   *
   * Unset means no limit. It matters most under `round_robin`, which rotates
   * without looking at load at all: an agent sitting on forty open tickets
   * keeps being handed the next one, and the queue is fair in a way that helps
   * nobody. Only auto-assignment respects it; a manager assigning by hand is
   * making a decision and is entitled to.
   */
  maxOpen?: number
}

/** Returns the agent to assign to, or undefined to leave it unassigned. */
export function assignTicket(options: AssignOptions): string | undefined {
  const algorithm = options.algorithm ?? 'least_busy'
  if (algorithm === 'manual') return undefined

  const available = options.candidates.filter(
    (candidate) =>
      candidate.available && (options.maxOpen === undefined || candidate.openTickets < options.maxOpen),
  )
  if (available.length === 0) return undefined

  if (algorithm === 'round_robin') {
    const order = [...available].sort((a, b) => a.id.localeCompare(b.id))
    const previous = order.findIndex((candidate) => candidate.id === options.lastAssignedId)
    // Wraps naturally when the previous assignee is gone or was last in line.
    return order[(previous + 1) % order.length]?.id
  }

  return [...available].sort(
    (a, b) => a.openTickets - b.openTickets || waited(b) - waited(a) || a.id.localeCompare(b.id),
  )[0]?.id
}

/**
 * How long since this agent was last handed something.
 *
 * An agent who has never been assigned anything has waited the longest, which
 * is why the missing case is the largest number rather than zero: somebody new
 * on the team should be first in line on a tie, not last forever.
 */
function waited(candidate: Availability): number {
  if (!candidate.lastAssignedAt) return Number.MAX_SAFE_INTEGER
  const at = Date.parse(candidate.lastAssignedAt)
  return Number.isFinite(at) ? Date.now() - at : Number.MAX_SAFE_INTEGER
}

/** Counts what each candidate currently has open, for `least_busy`. */
export function loadOf(tickets: Ticket[], ids: string[]): Availability[] {
  const counts = new Map<string, number>()
  const latest = new Map<string, string>()

  for (const ticket of tickets) {
    if (!ticket.assigneeId) continue
    counts.set(ticket.assigneeId, (counts.get(ticket.assigneeId) ?? 0) + 1)

    // Read off the same pass rather than tracked separately, so the tie-break
    // needs nothing the caller was not already holding.
    const seen = latest.get(ticket.assigneeId)
    if (!seen || ticket.createdAt > seen) latest.set(ticket.assigneeId, ticket.createdAt)
  }

  return ids.map((id) => ({
    id,
    available: true,
    openTickets: counts.get(id) ?? 0,
    ...(latest.has(id) ? { lastAssignedAt: latest.get(id) as string } : {}),
  }))
}
