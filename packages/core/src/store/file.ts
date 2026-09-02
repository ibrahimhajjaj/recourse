import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Conversation, Lead, Store, StoredMessage } from './types.js'
import type { Ticket, TicketFilter, TicketMessage } from '../helpdesk/types.js'
import type { SourceRecord } from '../knowledge/records.js'
import { newMessageId, pageTickets, searchIn } from './tickets.js'
import { computeStats } from './memory.js'
import { paginate } from './paginate.js'

export interface FileStoreOptions {
  /** Directory for the append-only logs. Created if missing. */
  dir: string
}

interface MessageRecord {
  kind: 'message'
  conversationId: string
  message: StoredMessage
  patch?: Partial<Conversation>
}

interface FeedbackRecord {
  kind: 'feedback'
  conversationId: string
  messageId: string
  feedback: 'positive' | 'negative' | null
}

interface ConversationRecord {
  kind: 'conversation'
  id: string
  patch: Partial<Conversation>
}

interface ConversationDelete {
  kind: 'conversation-delete'
  id: string
}

type Record_ = MessageRecord | FeedbackRecord | ConversationRecord | ConversationDelete

interface TicketRecord {
  kind: 'ticket'
  ticket: Ticket
}

interface TicketPatchRecord {
  kind: 'ticket-patch'
  ticketNumber: number
  patch: Partial<Ticket>
}

interface TicketMessageRecord {
  kind: 'ticket-message'
  message: TicketMessage
}

type TicketRecord_ = TicketRecord | TicketPatchRecord | TicketMessageRecord

interface SourceWrite {
  kind: 'source'
  source: SourceRecord
}

interface SourcePurge {
  kind: 'source-purge'
  ids: string[]
}

type SourceRecord_ = SourceWrite | SourcePurge

/**
 * Append-only logs on disk, folded into memory on first read.
 *
 * Append-only because it is the one write pattern that cannot corrupt earlier
 * data when the process dies mid-write, which matters when the alternative is
 * losing a customer's transcript. Suitable for a single self-hosted instance;
 * anything running more than one process at a time wants a real database
 * behind this same interface.
 */
export function fileStore(options: FileStoreOptions): Store {
  const conversationsLog = join(options.dir, 'conversations.jsonl')
  const leadsLog = join(options.dir, 'leads.jsonl')
  const ticketsLog = join(options.dir, 'tickets.jsonl')
  const sourcesLog = join(options.dir, 'sources.jsonl')

  const conversations = new Map<string, Conversation>()
  const messages = new Map<string, StoredMessage[]>()
  const leads: Lead[] = []
  const tickets = new Map<number, Ticket>()
  const ticketMessages = new Map<number, TicketMessage[]>()
  const sources = new Map<string, SourceRecord>()
  let nextTicketNumber = 1
  let loaded = false

  async function append(path: string, record: unknown) {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8')
  }

  async function load() {
    if (loaded) return
    loaded = true

    for (const line of await lines(conversationsLog)) {
      let record: Record_
      try {
        record = JSON.parse(line) as Record_
      } catch {
        // A half-written final line is the expected cost of append-only.
        continue
      }

      if (record.kind === 'message') {
        applyMessage(record)
      } else if (record.kind === 'feedback') {
        const message = messages.get(record.conversationId)?.find((entry) => entry.id === record.messageId)
        if (message) message.feedback = record.feedback
      } else if (record.kind === 'conversation') {
        const existing = conversations.get(record.id)
        if (existing) conversations.set(record.id, { ...existing, ...record.patch, id: record.id })
      } else if (record.kind === 'conversation-delete') {
        // Replayed in order, so a deletion undoes every message written before
        // it and leaves anything written after alone. The words survive in the
        // log file until it is compacted, which is the honest limit of a
        // delete on an append-only store and is why the widget calls this
        // best-effort.
        conversations.delete(record.id)
        messages.delete(record.id)
      }
    }

    for (const line of await lines(leadsLog)) {
      try {
        leads.push(JSON.parse(line) as Lead)
      } catch {
        continue
      }
    }

    for (const line of await lines(ticketsLog)) {
      let record: TicketRecord_
      try {
        record = JSON.parse(line) as TicketRecord_
      } catch {
        continue
      }

      if (record.kind === 'ticket') {
        tickets.set(record.ticket.ticketNumber, record.ticket)
        // The counter is derived, so it survives a restart without its own row.
        nextTicketNumber = Math.max(nextTicketNumber, record.ticket.ticketNumber + 1)
      } else if (record.kind === 'ticket-patch') {
        const existing = tickets.get(record.ticketNumber)
        if (existing) tickets.set(record.ticketNumber, { ...existing, ...record.patch })
      } else if (record.kind === 'ticket-message') {
        const thread = ticketMessages.get(record.message.ticketNumber) ?? []
        thread.push(record.message)
        ticketMessages.set(record.message.ticketNumber, thread)
      }
    }

    for (const line of await lines(sourcesLog)) {
      let record: SourceRecord_
      try {
        record = JSON.parse(line) as SourceRecord_
      } catch {
        continue
      }

      // Last write wins, which is what an append-only log of whole records means.
      if (record.kind === 'source') sources.set(record.source.id, record.source)
      else if (record.kind === 'source-purge') for (const id of record.ids) sources.delete(id)
    }
  }

  function applyMessage({ conversationId, message, patch }: MessageRecord) {
    const existing = conversations.get(conversationId)
    conversations.set(conversationId, {
      id: conversationId,
      channel: patch?.channel ?? existing?.channel ?? 'web',
      createdAt: existing?.createdAt ?? message.createdAt,
      updatedAt: message.createdAt,
      contact: patch?.contact ?? existing?.contact,
      ticketId: patch?.ticketId ?? existing?.ticketId,
      meta: { ...existing?.meta, ...patch?.meta },
    })
    const thread = messages.get(conversationId) ?? []
    thread.push(message)
    messages.set(conversationId, thread)
  }

  return {
    name: 'file',

    async appendMessage(conversationId, message, patch) {
      await load()
      const record: MessageRecord = { kind: 'message', conversationId, message, patch }
      applyMessage(record)
      await append(conversationsLog, record)
    },

    async getConversation(id) {
      await load()
      const conversation = conversations.get(id)
      if (!conversation) return null
      return { conversation, messages: messages.get(id) ?? [] }
    },

    async listConversations(listOptions = {}) {
      await load()
      const filtered = [...conversations.values()]
        .filter((conversation) => {
          if (listOptions.since && conversation.updatedAt < listOptions.since) return false
          if (listOptions.until && conversation.updatedAt > listOptions.until) return false
          if (listOptions.channel && conversation.channel !== listOptions.channel) return false
          if (
            listOptions.unansweredOnly &&
            !(messages.get(conversation.id) ?? []).some((message) => message.unanswered)
          ) {
            return false
          }
          return true
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return paginate(filtered, listOptions, (conversation) => conversation.id)
    },

    async updateConversation(id, patch) {
      await load()
      const existing = conversations.get(id)
      if (!existing) return
      conversations.set(id, { ...existing, ...patch, id, updatedAt: new Date().toISOString() })
      await append(conversationsLog, { kind: 'conversation', id, patch } satisfies ConversationRecord)
    },

    async patchMeta(id, patch) {
      await load()
      const existing = conversations.get(id)
      if (!existing) return

      const meta = { ...existing.meta }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete meta[key]
        else meta[key] = value
      }

      conversations.set(id, { ...existing, meta, updatedAt: new Date().toISOString() })
      await append(conversationsLog, { kind: 'conversation', id, patch: { meta } } satisfies ConversationRecord)
    },

    async setFeedback(conversationId, messageId, feedback) {
      await load()
      const message = messages.get(conversationId)?.find((entry) => entry.id === messageId)
      if (message) message.feedback = feedback
      await append(conversationsLog, {
        kind: 'feedback',
        conversationId,
        messageId,
        feedback,
      } satisfies FeedbackRecord)
    },

    async saveLead(lead) {
      await load()
      leads.push(lead)
      await append(leadsLog, lead)
    },

    async listLeads(listOptions = {}) {
      await load()
      const filtered = leads
        .filter((lead) => {
          if (listOptions.since && lead.createdAt < listOptions.since) return false
          if (listOptions.until && lead.createdAt > listOptions.until) return false
          return true
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return paginate(filtered, listOptions, (lead) => lead.id)
    },

    async stats(listOptions = {}) {
      await load()
      const inRange = [...conversations.values()].filter((conversation) => {
        if (listOptions.since && conversation.updatedAt < listOptions.since) return false
        if (listOptions.until && conversation.updatedAt > listOptions.until) return false
        return true
      })
      return computeStats(inRange, messages, leads)
    },

    async createTicket(draft) {
      await load()
      const ticket: Ticket = { ...draft, ticketNumber: nextTicketNumber++ }
      tickets.set(ticket.ticketNumber, ticket)
      await append(ticketsLog, { kind: 'ticket', ticket } satisfies TicketRecord)
      return ticket
    },

    async getTicket(ticketNumber) {
      await load()
      return tickets.get(ticketNumber) ?? null
    },

    async listTickets(filter: TicketFilter = {}) {
      await load()
      return pageTickets([...tickets.values()], filter)
    },

    async updateTicket(ticketNumber, patch) {
      await load()
      const existing = tickets.get(ticketNumber)
      if (!existing) return null

      const updated: Ticket = { ...existing, ...patch, ticketNumber, updatedAt: new Date().toISOString() }
      tickets.set(ticketNumber, updated)
      await append(ticketsLog, {
        kind: 'ticket-patch',
        ticketNumber,
        patch: { ...patch, updatedAt: updated.updatedAt },
      } satisfies TicketPatchRecord)
      return updated
    },

    async searchTickets(query, limit) {
      await load()
      return searchIn([...tickets.values()], ticketMessages, query, limit)
    },

    async addTicketMessage(draft) {
      await load()
      const message: TicketMessage = { ...draft, id: newMessageId() }
      const thread = ticketMessages.get(draft.ticketNumber) ?? []
      thread.push(message)
      ticketMessages.set(draft.ticketNumber, thread)
      await append(ticketsLog, { kind: 'ticket-message', message } satisfies TicketMessageRecord)

      const ticket = tickets.get(draft.ticketNumber)
      if (ticket) {
        const patch = { lastMessageAt: message.createdAt, updatedAt: message.createdAt }
        tickets.set(draft.ticketNumber, { ...ticket, ...patch })
        await append(ticketsLog, {
          kind: 'ticket-patch',
          ticketNumber: draft.ticketNumber,
          patch,
        } satisfies TicketPatchRecord)
      }

      return message
    },

    async listTicketMessages(ticketNumber, listOptions = {}) {
      await load()
      const thread = [...(ticketMessages.get(ticketNumber) ?? [])].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      )
      return paginate(thread, listOptions, (message) => message.id)
    },

    async createSource(record) {
      await load()
      sources.set(record.id, record)
      await append(sourcesLog, { kind: 'source', source: record } satisfies SourceWrite)
      return record
    },

    async getSource(id) {
      await load()
      return sources.get(id) ?? null
    },

    async listSources(listOptions = {}) {
      await load()
      const filtered = [...sources.values()]
        .filter((source) => !listOptions.status || source.status === listOptions.status)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return paginate(filtered, listOptions, (source) => source.id)
    },

    async updateSource(id, patch) {
      await load()
      const existing = sources.get(id)
      if (!existing) return null
      const updated = { ...existing, ...patch, id, updatedAt: new Date().toISOString() }
      sources.set(id, updated)
      await append(sourcesLog, { kind: 'source', source: updated } satisfies SourceWrite)
      return updated
    },

    async deleteSource(id) {
      await load()
      const existing = sources.get(id)
      if (!existing) return null
      const updated: SourceRecord = {
        ...existing,
        status: 'pending_deletion',
        updatedAt: new Date().toISOString(),
      }
      sources.set(id, updated)
      await append(sourcesLog, { kind: 'source', source: updated } satisfies SourceWrite)
      return updated
    },

    async restoreSource(id) {
      await load()
      const existing = sources.get(id)
      if (!existing) return null
      const updated: SourceRecord = { ...existing, status: 'active', updatedAt: new Date().toISOString() }
      sources.set(id, updated)
      await append(sourcesLog, { kind: 'source', source: updated } satisfies SourceWrite)
      return updated
    },

    async deleteConversation(conversationId: string) {
      await load()
      const existed = conversations.has(conversationId)

      conversations.delete(conversationId)
      messages.delete(conversationId)

      for (let index = leads.length - 1; index >= 0; index--) {
        if (leads[index]?.conversationId === conversationId) leads.splice(index, 1)
      }

      await append(conversationsLog, { kind: 'conversation-delete', id: conversationId } satisfies ConversationDelete)
      return existed
    },

    async purgeSources() {
      await load()
      const ids = [...sources.values()]
        .filter((source) => source.status === 'pending_deletion')
        .map((source) => source.id)

      for (const id of ids) sources.delete(id)
      if (ids.length > 0) await append(sourcesLog, { kind: 'source-purge', ids } satisfies SourcePurge)
      return ids.length
    },
  }
}

async function lines(path: string): Promise<string[]> {
  try {
    const text = await readFile(path, 'utf8')
    return text.split('\n').filter((line) => line.trim().length > 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
