import type { Ticket, TicketMessage } from './types.js'
import { RESOLVED_CATEGORIES } from './types.js'

/**
 * The numbers a support lead actually looks at.
 *
 * Deliberately medians rather than averages. One ticket that sat over a bank
 * holiday weekend moves a mean enough to hide a week of good work, and the
 * question being asked is "what does a customer normally wait", which is what
 * a median answers and a mean does not.
 *
 * Durations are milliseconds, and absent rather than zero when nothing
 * qualified. Zero is a real answer here, meaning somebody replied instantly,
 * and a metric that says zero when it means "no data" is worse than one that
 * says nothing.
 */
export interface TicketStats {
  created: number
  solved: number
  /** Still open: the backlog, which is the one worth watching over time. */
  unsolved: number
  byChannel: Record<string, number>
  byStatusCategory: Record<string, number>
  /** How long a customer waits for the first reply from a person. */
  medianFirstReplyMs?: number
  /** Across every reply, not only the first. */
  medianReplyMs?: number
  /** How long a ticket stays open before it is resolved. */
  medianTimeToCloseMs?: number
}

/**
 * Works out the ticket numbers from what the store already holds.
 *
 * A pure function over tickets and their threads, so every store gets the same
 * answers rather than four implementations of the same arithmetic, and so a
 * dashboard can compute them over any slice it has already fetched.
 */
export function ticketStats(tickets: Ticket[], threads: Map<number, TicketMessage[]>): TicketStats {
  const byChannel: Record<string, number> = {}
  const byStatusCategory: Record<string, number> = {}

  const firstReplies: number[] = []
  const replies: number[] = []
  const closes: number[] = []

  let solved = 0

  for (const ticket of tickets) {
    byChannel[ticket.channel] = (byChannel[ticket.channel] ?? 0) + 1
    byStatusCategory[ticket.statusCategory] = (byStatusCategory[ticket.statusCategory] ?? 0) + 1
    if (RESOLVED_CATEGORIES.includes(ticket.statusCategory)) solved++

    const thread = [...(threads.get(ticket.ticketNumber) ?? [])].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )

    // Only what a person sent, and only what the customer can see. A note is
    // written between colleagues and an event is the software talking to
    // itself; counting either as a response says the customer was answered
    // when nobody has spoken to them.
    let waitingSince = Date.parse(ticket.createdAt)
    let first = true

    for (const message of thread) {
      if (message.type === 'reply' && message.sender.type === 'customer') {
        // Their reply restarts the clock: what is being measured is how long
        // somebody waits after saying something, not since the ticket opened.
        if (!Number.isFinite(waitingSince)) waitingSince = Date.parse(message.createdAt)
        continue
      }

      if (message.type !== 'reply' || message.sender.type !== 'agent') continue

      const waited = Date.parse(message.createdAt) - waitingSince
      if (Number.isFinite(waited) && waited >= 0) {
        replies.push(waited)
        if (first) firstReplies.push(waited)
      }

      first = false
      waitingSince = Number.NaN
    }

    const closedAt = resolvedAt(ticket, thread)
    if (closedAt !== undefined) {
      const open = closedAt - Date.parse(ticket.createdAt)
      if (Number.isFinite(open) && open >= 0) closes.push(open)
    }
  }

  return {
    created: tickets.length,
    solved,
    unsolved: tickets.length - solved,
    byChannel,
    byStatusCategory,
    ...maybe('medianFirstReplyMs', firstReplies),
    ...maybe('medianReplyMs', replies),
    ...maybe('medianTimeToCloseMs', closes),
  }
}

/**
 * When a ticket was resolved, read off the status events on its thread.
 *
 * `updatedAt` cannot answer this: a ticket touched after it closed carries the
 * later time, so using it would report a ticket closed in an hour and edited a
 * week later as having taken a week.
 */
function resolvedAt(ticket: Ticket, thread: TicketMessage[]): number | undefined {
  if (!RESOLVED_CATEGORIES.includes(ticket.statusCategory)) return undefined

  // The last one, not the first: a ticket closed, reopened and closed again
  // was open until the second time.
  for (let at = thread.length - 1; at >= 0; at--) {
    const message = thread[at] as TicketMessage
    if (message.type !== 'event' || message.metadata?.event !== 'status') continue

    const parsed = Date.parse(message.createdAt)
    if (Number.isFinite(parsed)) return parsed
  }

  // No event on the thread, which a ticket imported from another desk will
  // not have. The last time anybody touched it is the best there is.
  const touched = Date.parse(ticket.updatedAt)
  return Number.isFinite(touched) ? touched : undefined
}

function maybe(key: string, values: number[]): Record<string, number> {
  return values.length > 0 ? { [key]: median(values) } : {}
}

/** The middle value, or the mean of the middle two on an even count. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
    : (sorted[middle] as number)
}
