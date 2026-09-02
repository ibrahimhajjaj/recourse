import type {
  Conversation,
  Lead,
  ListOptions,
  Stats,
  Store,
  StoredMessage,
} from './types.js'
import type { Ticket, TicketFilter, TicketMessage } from '../helpdesk/types.js'
import type { SourceRecord } from '../knowledge/records.js'
import { newMessageId, pageTickets, searchIn } from './tickets.js'
import { paginate } from './paginate.js'

// Re-exported here because the package's entry points name this module as
// pagination's home, and moving a public name is a change to the surface
// rather than to the layout.
export { paginate }

export interface MemoryStoreOptions {
  /** Conversations kept before the oldest are dropped. */
  maxConversations?: number
}

/**
 * Keeps everything in process memory.
 *
 * Right for a single instance, for local development, and for tests. Wrong for
 * anything serverless, where each instance has its own copy and none of them
 * survive a deploy. It exists so the analytics and help desk features work the
 * moment you turn them on, and so swapping in a real database later is a
 * one-line change rather than a rewrite.
 */
export function memoryStore(options: MemoryStoreOptions = {}): Store {
  const maxConversations = options.maxConversations ?? 5_000
  const conversations = new Map<string, Conversation>()
  const messages = new Map<string, StoredMessage[]>()
  const leads: Lead[] = []
  const tickets = new Map<number, Ticket>()
  const ticketMessages = new Map<number, TicketMessage[]>()
  const sources = new Map<string, SourceRecord>()
  let nextTicketNumber = 1

  function evictIfNeeded() {
    while (conversations.size > maxConversations) {
      // Map preserves insertion order, so the first key is the oldest.
      const oldest = conversations.keys().next().value
      if (oldest === undefined) break
      conversations.delete(oldest)
      messages.delete(oldest)
    }
  }

  return {
    name: 'memory',

    async appendMessage(conversationId, message, patch) {
      const existing = conversations.get(conversationId)

      conversations.set(conversationId, {
        id: conversationId,
        channel: patch?.channel ?? existing?.channel ?? 'web',
        // The message's own timestamp, not the wall clock, so importing a
        // backlog keeps its real ordering instead of collapsing to now.
        createdAt: existing?.createdAt ?? message.createdAt,
        updatedAt: message.createdAt,
        contact: patch?.contact ?? existing?.contact,
        ticketId: patch?.ticketId ?? existing?.ticketId,
        meta: { ...existing?.meta, ...patch?.meta },
      })

      const thread = messages.get(conversationId) ?? []
      thread.push(message)
      messages.set(conversationId, thread)
      evictIfNeeded()
    },

    async getConversation(id) {
      const conversation = conversations.get(id)
      if (!conversation) return null
      return { conversation, messages: messages.get(id) ?? [] }
    },

    async getConversations(ids) {
      const found = []
      for (const id of ids) {
        const conversation = conversations.get(id)
        if (conversation) found.push({ conversation, messages: messages.get(id) ?? [] })
      }
      return found
    },

    async listConversations(options = {}) {
      const filtered = [...conversations.values()]
        .filter((conversation) => matches(conversation, options, messages.get(conversation.id) ?? []))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return paginate(filtered, options, (conversation) => conversation.id)
    },

    async updateConversation(id, patch) {
      const existing = conversations.get(id)
      if (!existing) return
      conversations.set(id, { ...existing, ...patch, id, updatedAt: new Date().toISOString() })
    },

    async patchMeta(id, patch) {
      const existing = conversations.get(id)
      if (!existing) return

      const meta = { ...existing.meta }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete meta[key]
        else meta[key] = value
      }

      conversations.set(id, { ...existing, meta, updatedAt: new Date().toISOString() })
    },

    async setFeedback(conversationId, messageId, feedback) {
      const thread = messages.get(conversationId)
      const message = thread?.find((entry) => entry.id === messageId)
      if (message) message.feedback = feedback
    },

    async saveLead(lead) {
      leads.push(lead)
    },

    async listLeads(options = {}) {
      const filtered = leads
        .filter((lead) => withinRange(lead.createdAt, options))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return paginate(filtered, options, (lead) => lead.id)
    },

    async stats(options = {}) {
      return computeStats(
        [...conversations.values()].filter((conversation) => withinRange(conversation.updatedAt, options)),
        messages,
        leads.filter((lead) => withinRange(lead.createdAt, options)),
      )
    },

    async createTicket(draft) {
      const ticket: Ticket = { ...draft, ticketNumber: nextTicketNumber++ }
      tickets.set(ticket.ticketNumber, ticket)
      return ticket
    },

    async getTicket(ticketNumber) {
      return tickets.get(ticketNumber) ?? null
    },

    async listTickets(filter: TicketFilter = {}) {
      return pageTickets([...tickets.values()], filter)
    },

    async updateTicket(ticketNumber, patch) {
      const existing = tickets.get(ticketNumber)
      if (!existing) return null
      const updated: Ticket = {
        ...existing,
        ...patch,
        ticketNumber,
        updatedAt: new Date().toISOString(),
      }
      tickets.set(ticketNumber, updated)
      return updated
    },

    async searchTickets(query, limit) {
      return searchIn([...tickets.values()], ticketMessages, query, limit)
    },

    async addTicketMessage(draft) {
      const message: TicketMessage = { ...draft, id: newMessageId() }
      const thread = ticketMessages.get(draft.ticketNumber) ?? []
      thread.push(message)
      ticketMessages.set(draft.ticketNumber, thread)

      // A reply is the freshest activity on the ticket, and queues sort by it.
      const ticket = tickets.get(draft.ticketNumber)
      if (ticket) {
        tickets.set(draft.ticketNumber, {
          ...ticket,
          lastMessageAt: message.createdAt,
          updatedAt: message.createdAt,
        })
      }

      return message
    },

    async listTicketMessages(ticketNumber, options = {}) {
      const thread = [...(ticketMessages.get(ticketNumber) ?? [])].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      )
      return paginate(thread, options, (message) => message.id)
    },

    async createSource(record) {
      sources.set(record.id, record)
      return record
    },

    async getSource(id) {
      return sources.get(id) ?? null
    },

    async listSources(options = {}) {
      const filtered = [...sources.values()]
        .filter((source) => !options.status || source.status === options.status)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return paginate(filtered, options, (source) => source.id)
    },

    async updateSource(id, patch) {
      const existing = sources.get(id)
      if (!existing) return null
      const updated = { ...existing, ...patch, id, updatedAt: new Date().toISOString() }
      sources.set(id, updated)
      return updated
    },

    async deleteSource(id) {
      const existing = sources.get(id)
      if (!existing) return null
      const updated: SourceRecord = {
        ...existing,
        status: 'pending_deletion',
        updatedAt: new Date().toISOString(),
      }
      sources.set(id, updated)
      return updated
    },

    async restoreSource(id) {
      const existing = sources.get(id)
      if (!existing) return null
      const updated: SourceRecord = { ...existing, status: 'active', updatedAt: new Date().toISOString() }
      sources.set(id, updated)
      return updated
    },

    async purgeSources() {
      let removed = 0
      for (const [id, source] of sources) {
        if (source.status !== 'pending_deletion') continue
        sources.delete(id)
        removed++
      }
      return removed
    },

    async deleteConversation(conversationId: string) {
      const existed = conversations.delete(conversationId)
      messages.delete(conversationId)

      // A lead captured during the conversation goes with it. The customer
      // asked to be forgotten, and leaving their email address behind under a
      // conversation id that no longer exists is the worst of both.
      for (let index = leads.length - 1; index >= 0; index--) {
        if (leads[index]?.conversationId === conversationId) leads.splice(index, 1)
      }

      return existed
    },
  }
}

function withinRange(timestamp: string, options: ListOptions): boolean {
  if (options.since && timestamp < options.since) return false
  if (options.until && timestamp > options.until) return false
  return true
}

function matches(conversation: Conversation, options: ListOptions, thread: StoredMessage[]): boolean {
  if (!withinRange(conversation.updatedAt, options)) return false
  if (options.channel && conversation.channel !== options.channel) return false
  if (options.unansweredOnly && !thread.some((message) => message.unanswered)) return false
  return true
}

/** Shared by every store implementation, so the numbers mean the same thing. */
export function computeStats(
  conversations: Conversation[],
  messages: Map<string, StoredMessage[]>,
  leads: Lead[],
): Stats {
  const stats: Stats = {
    conversations: conversations.length,
    messages: 0,
    unanswered: 0,
    leads: leads.length,
    thumbsUp: 0,
    thumbsDown: 0,
    byChannel: {},
    topGaps: [],
    daily: [],
    activeUsers: { daily: 0, weekly: 0, stickiness: 0 },
    byAction: {},
    byCountry: {},
  }

  const gaps = new Map<string, number>()
  const days = new Map<string, { conversations: number; messages: number }>()
  const seen: Array<{ at: number; who: string }> = []

  const day = (at: string): string => at.slice(0, 10)
  const on = (date: string) => {
    let found = days.get(date)
    if (!found) days.set(date, (found = { conversations: 0, messages: 0 }))
    return found
  }

  for (const conversation of conversations) {
    stats.byChannel[conversation.channel] = (stats.byChannel[conversation.channel] ?? 0) + 1
    on(day(conversation.createdAt)).conversations++

    const country = conversation.meta?.country
    if (typeof country === 'string' && country) {
      stats.byCountry[country] = (stats.byCountry[country] ?? 0) + 1
    }

    const thread = messages.get(conversation.id) ?? []
    stats.messages += thread.length

    // Identity where there is one. Two conversations from the same signed-in
    // customer are one person; two anonymous ones cannot be told apart.
    const who = conversation.contact?.id ?? conversation.contact?.email ?? conversation.id

    for (const [position, message] of thread.entries()) {
      on(day(message.createdAt)).messages++
      if (message.role === 'user') seen.push({ at: Date.parse(message.createdAt), who })

      for (const action of message.actions ?? []) {
        stats.byAction[action.name] = (stats.byAction[action.name] ?? 0) + 1
      }

      if (message.feedback === 'positive') stats.thumbsUp++
      if (message.feedback === 'negative') stats.thumbsDown++
      if (!message.unanswered) continue

      stats.unanswered++
      // The question is the user turn that produced the unanswered reply.
      const question = thread[position - 1]?.role === 'user' ? thread[position - 1]?.content : message.content
      if (question) {
        const key = question.trim().toLowerCase().slice(0, 120)
        gaps.set(key, (gaps.get(key) ?? 0) + 1)
      }
    }
  }

  stats.topGaps = [...gaps.entries()]
    .map(([question, count]) => ({ question, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  stats.daily = [...days.entries()]
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date))

  stats.byAction = Object.fromEntries(
    Object.entries(stats.byAction).sort(([, a], [, b]) => b - a),
  )

  if (seen.length > 0) {
    // Anchored to the newest thing in the data. Anchoring to the clock makes
    // the same rows give different answers as the day passes, which is the
    // wrong property for a number somebody is comparing week on week.
    const newest = Math.max(...seen.map((one) => one.at))
    const DAY = 86_400_000

    const within = (span: number): number =>
      new Set(seen.filter((one) => newest - one.at < span).map((one) => one.who)).size

    const daily = within(DAY)
    const weekly = within(7 * DAY)
    stats.activeUsers = {
      daily,
      weekly,
      stickiness: weekly === 0 ? 0 : Math.round((daily / weekly) * 100) / 100,
    }
  }

  return stats
}
