import type { SourceRef } from '../types.js'
import type { Contact } from '../actions/types.js'

/**
 * Persistence for everything a conversation leaves behind.
 *
 * Answering a question needs no storage at all, which is why the agent works
 * without any of this. Everything a support team actually runs on does need it:
 * reading what customers asked, spotting the questions nobody can answer,
 * following up a lead, picking up a ticket a person has to finish.
 */

export type Channel = 'web' | 'email' | 'whatsapp' | 'slack' | 'sms' | 'api' | (string & {})

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
