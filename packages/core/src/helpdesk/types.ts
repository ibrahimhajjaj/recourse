import type { Channel } from '../store/types.js'

/**
 * The help desk: what happens after the agent hands over.
 *
 * The shape follows the categories a support team actually sorts by, which is
 * "whose move is it" rather than a free-text status. An agent looking at a
 * queue needs to know what is waiting on them, and no amount of custom labels
 * answers that unless the labels roll up to a fixed set.
 */
export type StatusCategory = 'new' | 'on_you' | 'on_customer' | 'on_hold' | 'closed' | 'cancelled'

export const STATUS_CATEGORIES: StatusCategory[] = [
  'new',
  'on_you',
  'on_customer',
  'on_hold',
  'closed',
  'cancelled',
]

/** Categories where the ticket is finished and should leave the working queue. */
export const RESOLVED_CATEGORIES: StatusCategory[] = ['closed', 'cancelled']

export interface TicketStatus {
  id: string
  category: StatusCategory
  /** What the customer sees. */
  externalLabel: string
  /** What the team sees. Often more blunt. */
  internalLabel: string
  color?: string
  /** Exactly one status per category is the default for that category. */
  isDefault: boolean
  position: number
}

export interface Team {
  id: string
  name: string
  isDefault: boolean
  /** Emails or ids of the people on it, used by the assignment algorithm. */
  members: string[]
}

export interface TicketCustomer {
  id?: string
  name?: string
  email?: string
  phoneNumber?: string
}

export interface Ticket {
  /** Sequential per help desk, so a customer can quote it. */
  ticketNumber: number
  subject: string
  description: string
  statusId: string
  statusCategory: StatusCategory
  /**
   * How many times this was closed and came back.
   *
   * The number a deflection rate cannot show. A ticket closed once is work
   * finished; the same ticket closed three times is a customer being handed the
   * same wrong answer three times, and it looks identical on a dashboard that
   * only counts closures.
   *
   * Counted on the transition rather than kept as a history, because the
   * question people ask is "how often does this come back", not "when".
   */
  reopened?: number
  assigneeId?: string
  teamId?: string
  customer: TicketCustomer
  channel: Channel
  conversationId?: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastMessageAt?: string
}

export type TicketMessageType = 'reply' | 'note' | 'event'

export interface TicketMessageSender {
  /** `system` covers everything the software did rather than a person. */
  type: 'customer' | 'agent' | 'system'
  id?: string
  name?: string
  email?: string
}

export interface TicketMessage {
  id: string
  ticketNumber: number
  type: TicketMessageType
  sender: TicketMessageSender
  content: string
  createdAt: string
  /** For an event, what happened. */
  metadata?: Record<string, unknown>
}

export interface TicketFilter {
  statusCategory?: StatusCategory | StatusCategory[]
  statusId?: string
  assigneeId?: string | null
  teamId?: string
  channel?: Channel
  /** Excludes closed and cancelled, which is what an agent's queue means. */
  openOnly?: boolean
  since?: string
  until?: string
  limit?: number
  cursor?: string
  /**
   * What to order the queue by. `updated` unless set.
   *
   * `created` is the only one of the three that cannot move. The other two
   * change as the queue is worked, which means a page window is not a
   * snapshot: a ticket somebody replies to while you are paging jumps to the
   * front, and the ticket that was behind it is never handed to you. For a
   * screen that is fine, and it is the ordering an inbox wants. For anything
   * walking every ticket exactly once, either sort by `created`, or use
   * `updated` ascending and remember the last timestamp you saw.
   *
   * `lastMessage` falls back to when the ticket was opened, since a ticket
   * nobody has replied to has no last message and belongs at the old end
   * rather than nowhere.
   */
  sortBy?: TicketSort
  /** `desc` unless set, newest first. */
  order?: 'asc' | 'desc'
  /**
   * Puts the number of matching tickets on the page.
   *
   * A second query, so it is off by default: a queue screen showing twenty
   * tickets does not need to know there are four thousand, and a dashboard
   * that says "342 open" does.
   */
  includeTotal?: boolean
}

export type TicketSort = 'created' | 'updated' | 'lastMessage'
