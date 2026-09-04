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
  /**
   * What the answer checks noticed but did not block: a figure no source
   * contains, most usefully. This is the list a business reads to find out
   * where its agent is guessing.
   */
  flags?: Array<{ category: string; score: number; reason: string }>
  /**
   * What the customer attached, without the bytes. A transcript is read months
   * later and by people who should not be handed a customer's uploaded ID; the
   * names and sizes are enough to understand the conversation.
   */
  attachments?: Array<{ name: string; mimeType: string; bytes?: number }>
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
  /** How many matched, when the caller asked for the count. */
  total?: number
}

export interface Store {
  name: string

  /** Creates the conversation if this is its first message. */
  appendMessage(conversationId: string, message: StoredMessage, conversation?: Partial<Conversation>): Promise<void>
  getConversation(id: string): Promise<{ conversation: Conversation; messages: StoredMessage[] } | null>
  /**
   * Several transcripts in one read.
   *
   * Optional, because the loop it replaces costs nothing on a store that is a
   * map in this process. It exists for the ones where every call is a round
   * trip: reading a page of conversations and their messages is one query per
   * row without it. Ids with nothing behind them are left out rather than
   * returned as nulls, and the order of the result is not promised.
   */
  getConversations?(ids: string[]): Promise<Array<{ conversation: Conversation; messages: StoredMessage[] }>>
  listConversations(options?: ListOptions): Promise<Page<Conversation>>
  updateConversation(id: string, patch: Partial<Conversation>): Promise<void>
  /**
   * Changes named keys on `meta` and leaves the rest alone.
   *
   * Optional, because a store that does not implement it still works: the
   * caller falls back to reading, merging and writing back. What that fallback
   * cannot do is survive two writers. A status webhook and a sweeper running
   * at the same moment each read the same `meta` and each write the whole
   * thing back, so one of them loses its key. A store that can do the merge
   * where the data lives should.
   *
   * A `null` value deletes the key, following JSON merge patch. `undefined`
   * never reaches here; the helper turns it into `null` first.
   *
   * Does nothing when the conversation does not exist, which is what
   * `updateConversation` does.
   */
  patchMeta?(id: string, patch: Record<string, unknown>): Promise<void>
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

  /**
   * Forgets one conversation and everything said in it.
   *
   * Hard rather than soft, unlike a source: the point of the call is that the
   * words are gone, so a tombstone carrying them would defeat it. Returns
   * whether there was anything to delete.
   *
   * Called when a visitor asks the widget to forget them. Best-effort privacy
   * for one browser tab rather than a compliance mechanism: a conversation id
   * is all the widget can prove it owns.
   */
  deleteConversation(conversationId: string): Promise<boolean>
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
  /**
   * One row per day that saw anything, oldest first.
   *
   * Days with no activity are absent rather than zero, because the gap is
   * information: a chart drawing them as zero and a chart leaving them out
   * tell you the same thing, and inventing rows costs a decision about which
   * timezone the day starts in for every reader.
   */
  daily: Array<{ date: string; conversations: number; messages: number }>
  /**
   * How many distinct people, and how many of the week's came back on the day.
   *
   * A person is their contact id or email where one is known, and the
   * conversation otherwise: an anonymous visitor is a person, but the same one
   * returning tomorrow without identifying themselves is counted twice, and no
   * store can tell the difference. Both windows end at the newest activity in
   * the data rather than at the wall clock, so the same data always gives the
   * same answer.
   */
  activeUsers: { daily: number; weekly: number; stickiness: number }
  /** How often each action ran, most used first when read as entries. */
  byAction: Record<string, number>
  /**
   * Conversations per two-letter country, for deployments that record one.
   *
   * Empty unless the server was configured to ask and the visitor agreed, so
   * an empty object means "not collected" as often as it means "nobody".
   */
  byCountry: Record<string, number>
}
