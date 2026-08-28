import type { Ticket, TicketFilter, TicketMessage } from '../helpdesk/types.js'
import { RESOLVED_CATEGORIES } from '../helpdesk/types.js'
import type { ListOptions, Page } from './types.js'
import { paginate } from './memory.js'

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

export function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function pageTickets(tickets: Ticket[], filter: TicketFilter = {}): Page<Ticket> {
  const listOptions: ListOptions = { limit: filter.limit, cursor: filter.cursor }
  return paginate(sortTickets(applyFilter(tickets, filter)), listOptions, (ticket) =>
    String(ticket.ticketNumber),
  )
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
