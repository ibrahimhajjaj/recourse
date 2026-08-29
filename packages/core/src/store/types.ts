import type { SourceRef } from '../types.js'
import type { Contact } from '../actions/types.js'
import type { Ticket, TicketFilter, TicketMessage } from '../helpdesk/types.js'
import type { SourceRecord, SourceStatus } from '../knowledge/records.js'

/**
 * Persistence for everything a conversation leaves behind.
 *
 * Answering a question needs no storage at all, which is why the agent works
 * without any of this. Everything a support team actually runs on does need it:
 * reading what customers asked, spotting the questions nobody can answer,
 * following up a lead, picking up a ticket a person has to finish.
 */

export type Channel = 'web' | 'email' | 'whatsapp' | 'slack' | 'sms' | 'phone' | 'api' | (string & {})

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** What the answer cited, kept so a reviewer can check the agent's work. */
  sources?: SourceRef[]
  /** Which actions ran on this turn, and what they returned. */
  actions?: Array<{ name: string; input: unknown; output: unknown }>
  /** Thumbs up or down from the customer. */
  feedback?: 'positive' | 'negative' | null
  /** True when retrieval found nothing, which marks a documentation gap. */
  unanswered?: boolean
}

export interface Conversation {
  id: string
  channel: Channel
  createdAt: string
  updatedAt: string
  contact?: Contact
  /** Set when the conversation was handed to a person. */
  ticketId?: string
  meta?: Record<string, unknown>
}

export interface Lead {
  id: string
  conversationId?: string
  createdAt: string
  values: Record<string, unknown>
}

export interface ListOptions {
  limit?: number
  /** Opaque cursor from a previous page. */
  cursor?: string
  channel?: Channel
  /** ISO timestamps. */
  since?: string
  until?: string
  /** Only conversations where the agent failed to answer something. */
  unansweredOnly?: boolean
}

export interface Page<T> {
  items: T[]
  /** Absent when there is nothing more to read. */
  cursor?: string
}

export interface Store {
  name: string

  /** Creates the conversation if this is its first message. */
  appendMessage(conversationId: string, message: StoredMessage, conversation?: Partial<Conversation>): Promise<void>
  getConversation(id: string): Promise<{ conversation: Conversation; messages: StoredMessage[] } | null>
  listConversations(options?: ListOptions): Promise<Page<Conversation>>
  updateConversation(id: string, patch: Partial<Conversation>): Promise<void>
  setFeedback(conversationId: string, messageId: string, feedback: 'positive' | 'negative' | null): Promise<void>

  saveLead(lead: Lead): Promise<void>
  listLeads(options?: ListOptions): Promise<Page<Lead>>

  /** Aggregates for the analytics view. */
  stats(options?: ListOptions): Promise<Stats>

  /**
   * Tickets. Kept on the same store as conversations so there is one thing to
   * configure and one thing to swap, and so a ticket can point back at the
   * conversation that produced it without a join across two systems.
   */
  createTicket(ticket: Omit<Ticket, 'ticketNumber'>): Promise<Ticket>
  getTicket(ticketNumber: number): Promise<Ticket | null>
  listTickets(filter?: TicketFilter): Promise<Page<Ticket>>
  updateTicket(ticketNumber: number, patch: Partial<Ticket>): Promise<Ticket | null>
  /** Free-text search across a ticket's subject, description and messages. */
  searchTickets(query: string, limit?: number): Promise<Ticket[]>

  addTicketMessage(message: Omit<TicketMessage, 'id'>): Promise<TicketMessage>
  listTicketMessages(ticketNumber: number, options?: ListOptions): Promise<Page<TicketMessage>>

  /**
   * Knowledge sources managed at runtime, so content can be added without a
   * deploy. Deletion is soft, because deleting the wrong source and having to
   * re-crawl a site is a bad afternoon.
   */
  createSource(record: SourceRecord): Promise<SourceRecord>
  getSource(id: string): Promise<SourceRecord | null>
  listSources(options?: ListOptions & { status?: SourceStatus }): Promise<Page<SourceRecord>>
  updateSource(id: string, patch: Partial<SourceRecord>): Promise<SourceRecord | null>
  /** Marks it for deletion. The content stays until it is purged. */
  deleteSource(id: string): Promise<SourceRecord | null>
  restoreSource(id: string): Promise<SourceRecord | null>
  /** Permanently removes everything marked for deletion. */
  purgeSources(): Promise<number>
}

export interface Stats {
  conversations: number
  messages: number
  /** Turns where retrieval found nothing. The list to fix, in priority order. */
  unanswered: number
  leads: number
  thumbsUp: number
  thumbsDown: number
  byChannel: Record<string, number>
  /** The questions that went unanswered most often. */
  topGaps: Array<{ question: string; count: number }>
}
