import type { TicketFilter, TicketSort } from './types.js'

/**
 * How a ticket queue is ordered, and how a cursor survives it.
 *
 * A keyset cursor is a position in one particular ordering. Hand the same
 * cursor to a differently sorted query and it is not a position at all: it
 * points at a row that is now somewhere else entirely, and the page that comes
 * back is quietly wrong rather than empty, which is the worst way for this to
 * fail. So the ordering travels inside the cursor and is checked on the way
 * back in.
 */
export interface TicketOrdering {
  sortBy: TicketSort
  order: 'asc' | 'desc'
}

/** The ordering a filter asks for, with the defaults filled in. */
export function orderingOf(filter: TicketFilter = {}): TicketOrdering {
  return { sortBy: filter.sortBy ?? 'updated', order: filter.order ?? 'desc' }
}

/** A cursor that remembers which ordering issued it. */
export function ticketCursor(ordering: TicketOrdering, ticketNumber: number): string {
  return `${ordering.sortBy}.${ordering.order}.${ticketNumber}`
}

/**
 * The ticket number a cursor points at.
 *
 * Throws when the ordering has changed under it, rather than paging on into
 * nonsense. Also accepts a bare number, because cursors handed out before this
 * existed are still in somebody's script.
 */
export function ticketCursorAt(cursor: string, ordering: TicketOrdering): number {
  const parts = cursor.split('.')

  if (parts.length === 1) {
    const bare = Number(cursor)
    if (!Number.isFinite(bare)) throw new Error(`not a ticket cursor: ${cursor}`)
    return bare
  }

  const [sortBy, order, ticketNumber] = parts
  if (sortBy !== ordering.sortBy || order !== ordering.order) {
    throw new Error(
      `this cursor was issued for ${sortBy} ${order} and the query asks for ${ordering.sortBy} ` +
        `${ordering.order}. Start the walk again rather than mixing the two.`,
    )
  }

  const at = Number(ticketNumber)
  if (!Number.isFinite(at)) throw new Error(`not a ticket cursor: ${cursor}`)
  return at
}

/** When a ticket sorts by, as an ISO string. */
export function sortedAt(
  ticket: { createdAt: string; updatedAt: string; lastMessageAt?: string },
  sortBy: TicketSort,
): string {
  if (sortBy === 'created') return ticket.createdAt
  if (sortBy === 'updated') return ticket.updatedAt
  // A ticket nobody has replied to belongs at the old end, not nowhere.
  return ticket.lastMessageAt ?? ticket.createdAt
}

/** The column, for a store that has one. `lastMessage` needs the fallback. */
export function sortColumn(sortBy: TicketSort): string {
  if (sortBy === 'created') return 'created_at'
  if (sortBy === 'updated') return 'updated_at'
  return 'COALESCE(last_message_at, created_at)'
}
