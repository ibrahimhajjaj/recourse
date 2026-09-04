import type { Ticket, TicketFilter, TicketMessage } from '../helpdesk/types.js'
import { RESOLVED_CATEGORIES } from '../helpdesk/types.js'
import type { Page } from './types.js'
import { pageSize } from './paginate.js'
import { orderingOf, sortedAt, ticketCursor, ticketCursorAt, type TicketOrdering } from '../helpdesk/ordering.js'

/**
 * The ticket half of a store, kept here so the memory and file implementations
 * share one set of semantics rather than drifting apart.
 */
export interface TicketTables {
  tickets: Map<number, Ticket>
  messages: Map<number, TicketMessage[]>
  nextNumber: () => number
}

export function applyFilter(tickets: Ticket[], filter: TicketFilter = {}): Ticket[] {
  return tickets.filter((ticket) => {
    if (filter.openOnly && RESOLVED_CATEGORIES.includes(ticket.statusCategory)) return false

    if (filter.statusCategory) {
      const allowed = Array.isArray(filter.statusCategory) ? filter.statusCategory : [filter.statusCategory]
      if (!allowed.includes(ticket.statusCategory)) return false
    }

    if (filter.statusId && ticket.statusId !== filter.statusId) return false
    if (filter.teamId && ticket.teamId !== filter.teamId) return false
    if (filter.channel && ticket.channel !== filter.channel) return false

    // `null` means unassigned, which is a real thing to filter a queue by.
    if (filter.assigneeId !== undefined) {
      if (filter.assigneeId === null && ticket.assigneeId) return false
      if (filter.assigneeId !== null && ticket.assigneeId !== filter.assigneeId) return false
    }

    if (filter.since && ticket.updatedAt < filter.since) return false
    if (filter.until && ticket.updatedAt > filter.until) return false

    return true
  })
}

/**
 * Where one ticket sits relative to another in an ordering.
 *
 * Shared by the sort and the cursor so the two cannot disagree. They did not
 * have to be separate to drift: a cursor that decides "after" by any rule but
 * the one that laid the list out will hand back a page that overlaps or skips.
 */
function compare(a: Ticket, b: Ticket, ordering: TicketOrdering): number {
  const direction = ordering.order === 'asc' ? 1 : -1
  const compared = sortedAt(a, ordering.sortBy).localeCompare(sortedAt(b, ordering.sortBy))

  // The ticket number breaks a tie, and it has to break it the same way the
  // dates were ordered or two tickets opened in the same millisecond swap
  // places between pages and one of them is never handed over.
  return direction * (compared || a.ticketNumber - b.ticketNumber)
}

export function sortTickets(tickets: Ticket[], ordering = orderingOf()): Ticket[] {
  return [...tickets].sort((a, b) => compare(a, b, ordering))
}

export function pageTickets(tickets: Ticket[], filter: TicketFilter = {}): Page<Ticket> {
  const ordering = orderingOf(filter)
  const matching = applyFilter(tickets, filter)
  const sorted = sortTickets(matching, ordering)
  const limit = pageSize(filter.limit)

  let start = 0

  if (filter.cursor) {
    const at = ticketCursorAt(filter.cursor, ordering)

    // Looked up among every ticket rather than only the matching ones, which
    // is what the SQL stores do and the reason they were right. Walking an
    // open queue while somebody closes a ticket you already passed used to end
    // the listing there: the cursor was no longer in the filtered list, so it
    // could not be found, and the rest of the queue was silently dropped.
    const anchor = tickets.find((ticket) => ticket.ticketNumber === at)

    // Deleted since it was handed out. The listing ends rather than starting
    // again, because restarting looks like a first page to a caller looping
    // until the cursor runs out, so it never runs out.
    if (!anchor) return { items: [] }

    const found = sorted.findIndex((ticket) => compare(ticket, anchor, ordering) > 0)
    start = found === -1 ? sorted.length : found
  }

  const slice = sorted.slice(start, start + limit)
  const last = slice[slice.length - 1]

  return {
    items: slice,
    ...(start + slice.length < sorted.length && last
      ? { cursor: ticketCursor(ordering, last.ticketNumber) }
      : {}),
    ...(filter.includeTotal ? { total: matching.length } : {}),
  }
}

/**
 * Ranks by how many query words a ticket contains, across its subject,
 * description and every message on it. Deliberately simple: a support agent
 * searching a ticket queue is looking for one they already half remember, not
 * running an information retrieval benchmark.
 */
export function searchIn(
  tickets: Ticket[],
  messages: Map<number, TicketMessage[]>,
  query: string,
  limit = 25,
): Ticket[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1)
  if (words.length === 0) return []

  const scored: Array<{ ticket: Ticket; score: number }> = []

  for (const ticket of tickets) {
    const haystack = [
      ticket.subject,
      ticket.description,
      ticket.customer.email ?? '',
      ...(messages.get(ticket.ticketNumber) ?? []).map((message) => message.content),
    ]
      .join('\n')
      .toLowerCase()

    const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0)
    if (score > 0) scored.push({ ticket, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || b.ticket.updatedAt.localeCompare(a.ticket.updatedAt))
    .slice(0, limit)
    .map((entry) => entry.ticket)
}

export function newMessageId(): string {
  return `tm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
