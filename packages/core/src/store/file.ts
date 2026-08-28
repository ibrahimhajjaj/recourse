import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Conversation, Lead, Store, StoredMessage } from './types.js'
import { computeStats, paginate } from './memory.js'

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

type Record_ = MessageRecord | FeedbackRecord | ConversationRecord

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

  const conversations = new Map<string, Conversation>()
  const messages = new Map<string, StoredMessage[]>()
  const leads: Lead[] = []
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
      }
    }

    for (const line of await lines(leadsLog)) {
      try {
        leads.push(JSON.parse(line) as Lead)
      } catch {
        continue
      }
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
