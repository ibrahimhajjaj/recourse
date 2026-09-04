/**
 * The Store, backed by Cloudflare D1.
 *
 * The reason to want this over Postgres is the deployment rather than the
 * database: a Worker reaches D1 through a binding, so there is no connection
 * pool, no credential, and nothing to exhaust. On a runtime where every
 * instance opening a pool is the failure mode, not having pools is the feature.
 *
 * What it costs is a smaller ceiling and a query budget. D1 gives 10GB per
 * database on a paid plan and 500MB free, and **50 queries per Worker
 * invocation on the free tier**, which is the limit that will actually catch
 * someone out, because it is per request rather than per day.
 *
 * Cloudflare's own guidance is many small databases rather than one large one,
 * which happens to suit this product: one per business.
 */

import type {
  Conversation,
  Lead,
  ListOptions,
  Page,
  SourceRecord,
  Stats,
  StoredMessage,
  Store,
  Ticket,
  TicketMessage,
} from '@recourse-ai/core'
import { pageSize } from '@recourse-ai/core/store'
import { orderingOf, sortColumn, ticketCursor, ticketCursorAt } from '@recourse-ai/core'
import { SCHEMA } from './schema.js'

/**
 * The shape of a D1 binding.
 *
 * Declared structurally rather than imported from `@cloudflare/workers-types`,
 * so this package pulls in nothing and the tests can drive it with a shim over
 * `node:sqlite`.
 */
export interface D1Like {
  prepare(sql: string): D1Statement
  batch?(statements: D1Statement[]): Promise<unknown[]>
  exec?(sql: string): Promise<unknown>
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta?: { last_row_id?: number; changes?: number } }>
}

export interface D1StoreOptions {
  db: D1Like
  /** Creates the tables on first use. */
  migrate?: boolean
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function d1Store(options: D1StoreOptions): Store {
  const db = options.db
  const shouldMigrate = options.migrate !== false

  let migrated: Promise<void> | null = null
  async function ready(): Promise<D1Like> {
    if (!shouldMigrate) return db
    migrated ??= migrate(db)
    await migrated
    return db
  }

  async function all<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
    const database = await ready()
    const { results } = await database.prepare(sql).bind(...values).all<T>()
    return results ?? []
  }

  async function first<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T | null> {
    const database = await ready()
    return database.prepare(sql).bind(...values).first<T>()
  }

  async function run(sql: string, values: unknown[] = []): Promise<{ meta?: { last_row_id?: number } }> {
    const database = await ready()
    return database.prepare(sql).bind(...values).run()
  }

  return {
    name: 'd1',

    async appendMessage(conversationId, message, conversation) {
      const now = new Date().toISOString()
      const createdAt = message.createdAt ?? now

      // Two statements rather than a transaction: D1 has no interactive
      // transactions, and `batch` is atomic but cannot read between steps.
      // Neither is needed here, because both statements are idempotent.
      await run(
        `INSERT INTO conversations (id, channel, created_at, updated_at, contact, ticket_id, meta)
         VALUES (?1, COALESCE(?2, 'web'), ?3, ?3, ?4, ?5, ?6)
         ON CONFLICT (id) DO UPDATE SET
           updated_at = excluded.updated_at,
           -- ?2 rather than excluded.channel: on a later message with no
           -- conversation argument that parameter is null, and a WhatsApp
           -- thread must not quietly become a web one.
           channel    = COALESCE(?2, conversations.channel),
           contact    = COALESCE(excluded.contact, conversations.contact),
           ticket_id  = COALESCE(excluded.ticket_id, conversations.ticket_id),
           -- Merged rather than replaced: a later message carrying nothing but
           -- a country would otherwise take the handover flag, the insight and
           -- the coalescing hold with it, and the agent would answer over the
           -- person who took the conversation over.
           meta       = json_patch(COALESCE(conversations.meta, '{}'), COALESCE(excluded.meta, '{}'))`,
        [
          conversationId,
          conversation?.channel ?? null,
          createdAt,
          json(conversation?.contact),
          conversation?.ticketId ?? null,
          json(conversation?.meta),
        ],
      )

      await run(
        `INSERT OR IGNORE INTO messages
           (id, conversation_id, role, content, created_at, sources, actions, attachments, flags, feedback, unanswered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          conversationId,
          message.role,
          message.content,
          createdAt,
          json(message.sources),
          json(message.actions),
          json(message.attachments),
          json(message.flags),
          message.feedback ?? null,
          message.unanswered ? 1 : 0,
        ],
      )
    },

    async getConversation(id) {
      const row = await first<ConversationRow>(`SELECT * FROM conversations WHERE id = ?`, [id])
      if (!row) return null

      const messages = await all<MessageRow>(
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC`,
        [id],
      )

      return { conversation: toConversation(row), messages: messages.map(toMessage) }
    },

    async getConversations(ids) {
      if (ids.length === 0) return []

      const found: Array<{ conversation: Conversation; messages: StoredMessage[] }> = []

      // Chunked because a statement can only bind so many parameters, and D1
      // is stricter about that than SQLite itself. Fifty is well inside every
      // limit and still turns a page of conversations into a handful of
      // queries rather than one per row, which is the budget that runs out
      // first on a Worker.
      for (let from = 0; from < ids.length; from += 50) {
        const slice = ids.slice(from, from + 50)
        const holes = slice.map(() => '?').join(',')

        const rows = await all<ConversationRow>(
          `SELECT * FROM conversations WHERE id IN (${holes})`,
          slice,
        )
        if (rows.length === 0) continue

        const present = rows.map((row) => row.id)
        const messages = await all<MessageRow & { conversation_id: string }>(
          `SELECT * FROM messages WHERE conversation_id IN (${present.map(() => '?').join(',')})
           ORDER BY conversation_id, seq ASC`,
          present,
        )

        const byConversation = new Map<string, StoredMessage[]>()
        for (const row of messages) {
          const held = byConversation.get(row.conversation_id)
          if (held) held.push(toMessage(row))
          else byConversation.set(row.conversation_id, [toMessage(row)])
        }

        for (const row of rows) {
          found.push({ conversation: toConversation(row), messages: byConversation.get(row.id) ?? [] })
        }
      }

      return found
    },

    async listConversations(options = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (options.channel) {
        where.push('channel = ?')
        values.push(options.channel)
      }
      if (options.contactId) {
        // The contact is a JSON blob rather than its own column, so this reads
        // the id out of it. Fine at this size: a contact lookup is a support
        // agent looking somebody up, not a query on every turn.
        where.push(`json_extract(contact, '$.id') = ?`)
        values.push(options.contactId)
      }
      if (options.since) {
        where.push('updated_at >= ?')
        values.push(options.since)
      }
      if (options.until) {
        where.push('updated_at <= ?')
        values.push(options.until)
      }
      if (options.unansweredOnly) {
        where.push('EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id AND m.unanswered = 1)')
      }
      if (options.cursor) {
        // The cursor is the previous page's last id, matching every other
        // implementation, so a cursor survives swapping the store.
        where.push(
          `(updated_at, id) < (SELECT updated_at, id FROM conversations WHERE id = ?)`,
        )
        values.push(options.cursor)
      }

      const limit = capLimit(options.limit)
      values.push(limit + 1)

      const rows = await all<ConversationRow>(
        `SELECT * FROM conversations
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
        values,
      )

      return toPage(rows.map(toConversation), rows.length > limit, limit, (item) => item.id)
    },

    async updateConversation(id, patch) {
      const sets = ['updated_at = ?']
      const values: unknown[] = [new Date().toISOString()]

      for (const [key, column, encode] of [
        ['channel', 'channel', (v: unknown) => v],
        ['contact', 'contact', json],
        ['ticketId', 'ticket_id', (v: unknown) => v ?? null],
        ['meta', 'meta', json],
      ] as const) {
        if (patch[key] === undefined) continue
        sets.push(`${column} = ?`)
        values.push(encode(patch[key]))
      }

      values.push(id)
      await run(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, values)
    },

    async patchMeta(id, patch) {
      // One statement, so two writers changing different keys cannot each read
      // the whole object and write back over the other.
      await run(
        `UPDATE conversations
            SET updated_at = ?, meta = json_patch(COALESCE(meta, '{}'), ?)
          WHERE id = ?`,
        [new Date().toISOString(), JSON.stringify(patch), id],
      )
    },

    async setFeedback(conversationId, messageId, feedback) {
      await run(`UPDATE messages SET feedback = ? WHERE conversation_id = ? AND id = ?`, [
        feedback,
        conversationId,
        messageId,
      ])
    },

    async saveLead(lead) {
      await run(
        `INSERT INTO leads (id, conversation_id, created_at, values_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET values_json = excluded.values_json`,
        [lead.id, lead.conversationId ?? null, lead.createdAt, json(lead.values) ?? '{}'],
      )
    },

    async listLeads(options = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (options.since) {
        where.push('created_at >= ?')
        values.push(options.since)
      }
      if (options.until) {
        where.push('created_at <= ?')
        values.push(options.until)
      }
      if (options.cursor) {
        where.push(`(created_at, id) < (SELECT created_at, id FROM leads WHERE id = ?)`)
        values.push(options.cursor)
      }

      const limit = capLimit(options.limit)
      values.push(limit + 1)

      const rows = await all<LeadRow>(
        `SELECT * FROM leads
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        values,
      )

      return toPage(rows.map(toLead), rows.length > limit, limit, (item) => item.id)
    },

    async stats(options = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (options.channel) {
        where.push('c.channel = ?')
        values.push(options.channel)
      }
      if (options.since) {
        where.push('c.updated_at >= ?')
        values.push(options.since)
      }
      if (options.until) {
        where.push('c.updated_at <= ?')
        values.push(options.until)
      }

      const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

      // Several statements rather than one, because the free tier allows fifty
      // queries per invocation and these are five of them, not fifty. A single
      // query with correlated subselects reads worse and saves nothing.
      const totals = await first<{ conversations: number; messages: number; unanswered: number; up: number; down: number }>(
        `SELECT
           (SELECT count(*) FROM conversations c ${filter}) AS conversations,
           (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id ${filter}) AS messages,
           (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id ${filter ? `${filter} AND` : 'WHERE'} m.unanswered = 1) AS unanswered,
           (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id ${filter ? `${filter} AND` : 'WHERE'} m.feedback = 'positive') AS up,
           (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id ${filter ? `${filter} AND` : 'WHERE'} m.feedback = 'negative') AS down`,
        [...values, ...values, ...values, ...values, ...values],
      )

      const leadWhere: string[] = []
      const leadValues: unknown[] = []
      if (options.since) {
        leadWhere.push('created_at >= ?')
        leadValues.push(options.since)
      }
      if (options.until) {
        leadWhere.push('created_at <= ?')
        leadValues.push(options.until)
      }
      const leads = await first<{ total: number }>(
        `SELECT count(*) AS total FROM leads ${leadWhere.length > 0 ? `WHERE ${leadWhere.join(' AND ')}` : ''}`,
        leadValues,
      )

      const channels = await all<{ channel: string; total: number }>(
        `SELECT channel, count(*) AS total FROM conversations c ${filter} GROUP BY channel`,
        values,
      )

      // The question is the user turn before the unanswered reply, matching
      // the shared implementation exactly: trimmed, lowercased, first 120.
      const gaps = await all<{ question: string; total: number }>(
        `WITH threads AS (
           SELECT m.*, LAG(m.content) OVER (PARTITION BY m.conversation_id ORDER BY m.seq) AS previous_content,
                       LAG(m.role)    OVER (PARTITION BY m.conversation_id ORDER BY m.seq) AS previous_role
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           ${filter}
         )
         SELECT substr(lower(trim(CASE WHEN previous_role = 'user' THEN previous_content ELSE content END)), 1, 120) AS question,
                count(*) AS total
         FROM threads
         WHERE unanswered = 1 AND question <> ''
         GROUP BY question
         ORDER BY total DESC
         LIMIT 20`,
        values,
      )

      // A day is the first ten characters of the timestamp, which is the same
      // slice the shared implementation takes, so the two cannot disagree
      // about which side of midnight something fell on.
      const daily = await all<{ date: string; conversations: number; messages: number }>(
        `SELECT date,
                sum(c) AS conversations,
                sum(m) AS messages
         FROM (
           SELECT substr(c.created_at, 1, 10) AS date, 1 AS c, 0 AS m FROM conversations c ${filter}
           UNION ALL
           SELECT substr(m.created_at, 1, 10), 0, 1
           FROM messages m JOIN conversations c ON c.id = m.conversation_id ${filter}
         )
         GROUP BY date
         ORDER BY date`,
        [...values, ...values],
      )

      // SQLite has no json_each until the JSON1 extension, which D1 ships, so
      // the actions column is unpacked the same way the rows were written.
      const actions = await all<{ name: string; total: number }>(
        `SELECT json_extract(action.value, '$.name') AS name, count(*) AS total
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN json_each(coalesce(m.actions, '[]')) AS action
         ${filter}
         GROUP BY name
         ORDER BY total DESC`,
        values,
      )

      // Identity where there is one, the conversation otherwise, and both
      // windows end at the newest user turn rather than at the clock.
      const people = await first<{ daily: number; weekly: number }>(
        `WITH people AS (
           SELECT m.created_at AS at,
                  coalesce(
                    nullif(json_extract(c.contact, '$.id'), ''),
                    nullif(json_extract(c.contact, '$.email'), ''),
                    c.id
                  ) AS who
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           ${filter ? `${filter} AND` : 'WHERE'} m.role = 'user'
         ),
         newest AS (SELECT max(at) AS at FROM people)
         SELECT
           (SELECT count(DISTINCT who) FROM people
             WHERE at > datetime((SELECT at FROM newest), '-1 day')) AS daily,
           (SELECT count(DISTINCT who) FROM people
             WHERE at > datetime((SELECT at FROM newest), '-7 days')) AS weekly`,
        values,
      )

      const countries = await all<{ country: string; total: number }>(
        `SELECT json_extract(c.meta, '$.country') AS country, count(*) AS total
         FROM conversations c ${filter}
         GROUP BY country
         HAVING country IS NOT NULL AND country <> ''`,
        values,
      )

      const weekly = people?.weekly ?? 0

      return {
        conversations: totals?.conversations ?? 0,
        messages: totals?.messages ?? 0,
        unanswered: totals?.unanswered ?? 0,
        leads: leads?.total ?? 0,
        thumbsUp: totals?.up ?? 0,
        thumbsDown: totals?.down ?? 0,
        byChannel: Object.fromEntries(channels.map((row) => [row.channel, row.total])),
        topGaps: gaps.map((row) => ({ question: row.question, count: row.total })),
        daily: daily.map((row) => ({
          date: row.date,
          conversations: row.conversations,
          messages: row.messages,
        })),
        byAction: Object.fromEntries(actions.map((row) => [row.name, row.total])),
        byCountry: Object.fromEntries(countries.map((row) => [row.country, row.total])),
        activeUsers: {
          daily: people?.daily ?? 0,
          weekly,
          stickiness: weekly === 0 ? 0 : Math.round(((people?.daily ?? 0) / weekly) * 100) / 100,
        },
      } satisfies Stats
    },

    async createTicket(ticket) {
      const result = await run(
        `INSERT INTO tickets
           (subject, description, status_id, status_category, assignee_id, team_id,
            customer, channel, conversation_id, metadata, created_at, updated_at, last_message_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ticket.subject,
          ticket.description,
          ticket.statusId,
          ticket.statusCategory,
          ticket.assigneeId ?? null,
          ticket.teamId ?? null,
          json(ticket.customer) ?? '{}',
          ticket.channel,
          ticket.conversationId ?? null,
          json(ticket.metadata) ?? '{}',
          ticket.createdAt,
          ticket.updatedAt,
          ticket.lastMessageAt ?? null,
        ],
      )

      const ticketNumber = Number(result.meta?.last_row_id ?? 0)

      // Written explicitly rather than by a trigger: D1 runs statements one at
      // a time, so a trigger buys nothing and hides where the write happens.
      await run(`INSERT INTO tickets_fts (rowid, subject, description, body) VALUES (?, ?, ?, '')`, [
        ticketNumber,
        ticket.subject,
        ticket.description,
      ])

      return { ...ticket, ticketNumber } as Ticket
    },

    async getTicket(ticketNumber) {
      const row = await first<TicketRow>(`SELECT * FROM tickets WHERE ticket_number = ?`, [ticketNumber])
      return row ? toTicket(row) : null
    },

    async listTickets(filter = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (filter.statusCategory) {
        const categories = Array.isArray(filter.statusCategory) ? filter.statusCategory : [filter.statusCategory]
        where.push(`status_category IN (${categories.map(() => '?').join(', ')})`)
        values.push(...categories)
      }
      if (filter.statusId) {
        where.push('status_id = ?')
        values.push(filter.statusId)
      }
      if (filter.assigneeId === null) {
        where.push('assignee_id IS NULL')
      } else if (filter.assigneeId !== undefined) {
        where.push('assignee_id = ?')
        values.push(filter.assigneeId)
      }
      if (filter.teamId) {
        where.push('team_id = ?')
        values.push(filter.teamId)
      }
      if (filter.channel) {
        where.push('channel = ?')
        values.push(filter.channel)
      }
      if (filter.openOnly) {
        where.push(`status_category NOT IN ('closed', 'cancelled')`)
      }
      if (filter.since) {
        where.push('updated_at >= ?')
        values.push(filter.since)
      }
      if (filter.until) {
        where.push('updated_at <= ?')
        values.push(filter.until)
      }
      // Counted before the cursor is applied: the total is how many match the
      // query, not how many are left after where you have read up to.
      const matching = filter.includeTotal
        ? await first<{ total: number }>(
            `SELECT COUNT(*) AS total FROM tickets ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`,
            [...values],
          )
        : null

      const ordering = orderingOf(filter)
      const column = sortColumn(ordering.sortBy)
      const direction = ordering.order === 'asc' ? 'ASC' : 'DESC'

      if (filter.cursor) {
        // Row values against the same expression the ordering uses, so a tie on
        // the timestamp falls to the ticket number the same way both times.
        const after = ordering.order === 'asc' ? '>' : '<'
        where.push(
          `(${column}, ticket_number) ${after} ` +
            `(SELECT ${column}, ticket_number FROM tickets WHERE ticket_number = ?)`,
        )
        values.push(ticketCursorAt(filter.cursor, ordering))
      }

      const limit = capLimit(filter.limit)
      values.push(limit + 1)

      const rows = await all<TicketRow>(
        `SELECT * FROM tickets
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY ${column} ${direction}, ticket_number ${direction}
         LIMIT ?`,
        values,
      )

      const page = toPage(rows.map(toTicket), rows.length > limit, limit, (item) => String(item.ticketNumber))
      const last = page.items[page.items.length - 1]

      return {
        items: page.items,
        ...(page.cursor && last ? { cursor: ticketCursor(ordering, last.ticketNumber) } : {}),
        ...(matching ? { total: Number(matching.total) } : {}),
      }
    },

    async updateTicket(ticketNumber, patch) {
      const sets = ['updated_at = ?']
      const values: unknown[] = [patch.updatedAt ?? new Date().toISOString()]

      for (const [key, column, encode] of [
        ['subject', 'subject', (v: unknown) => v],
        ['description', 'description', (v: unknown) => v],
        ['statusId', 'status_id', (v: unknown) => v],
        ['statusCategory', 'status_category', (v: unknown) => v],
        ['assigneeId', 'assignee_id', (v: unknown) => v ?? null],
        ['teamId', 'team_id', (v: unknown) => v ?? null],
        ['customer', 'customer', json],
        ['channel', 'channel', (v: unknown) => v],
        ['conversationId', 'conversation_id', (v: unknown) => v ?? null],
        ['metadata', 'metadata', json],
        ['lastMessageAt', 'last_message_at', (v: unknown) => v ?? null],
      ] as const) {
        if (patch[key] === undefined) continue
        sets.push(`${column} = ?`)
        values.push(encode(patch[key]))
      }

      values.push(ticketNumber)
      await run(`UPDATE tickets SET ${sets.join(', ')} WHERE ticket_number = ?`, values)

      if (patch.subject !== undefined || patch.description !== undefined) {
        const row = await first<TicketRow>(`SELECT * FROM tickets WHERE ticket_number = ?`, [ticketNumber])
        if (row) {
          await run(`DELETE FROM tickets_fts WHERE rowid = ?`, [ticketNumber])
          await run(`INSERT INTO tickets_fts (rowid, subject, description, body) VALUES (?, ?, ?, '')`, [
            ticketNumber,
            row.subject,
            row.description,
          ])
        }
      }

      const updated = await first<TicketRow>(`SELECT * FROM tickets WHERE ticket_number = ?`, [ticketNumber])
      return updated ? toTicket(updated) : null
    },

    async searchTickets(search, limit = 20) {
      const term = search.trim()
      if (!term) return []

      // FTS5's query syntax treats punctuation as operators, so a search box
      // containing an apostrophe is a syntax error rather than a search.
      // Quoting each word makes every input a literal term match.
      const safe = term
        .split(/\s+/)
        .map((word) => word.replace(/["']/g, ''))
        .filter(Boolean)
        .map((word) => `"${word}"`)
        .join(' OR ')

      if (!safe) return []

      const rows = await all<TicketRow>(
        `SELECT t.* FROM tickets t
         WHERE t.ticket_number IN (SELECT rowid FROM tickets_fts WHERE tickets_fts MATCH ?)
            OR t.ticket_number IN (
                 SELECT ticket_number FROM ticket_messages
                 WHERE ticket_number IN (SELECT rowid FROM tickets_fts WHERE tickets_fts MATCH ?)
               )
         ORDER BY t.updated_at DESC, t.ticket_number DESC
         LIMIT ?`,
        [safe, safe, Math.min(limit, MAX_LIMIT)],
      )

      return rows.map(toTicket)
    },

    async addTicketMessage(message) {
      const id = `tm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

      await run(
        `INSERT INTO ticket_messages (id, ticket_number, type, body, sender, created_at, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          message.ticketNumber,
          message.type,
          message.content,
          json(message.sender) ?? '{}',
          message.createdAt,
          json(message.metadata),
        ],
      )

      // The message body joins the ticket's searchable text, so a ticket can
      // be found by something only a reply said.
      const existing = await first<{ subject: string; description: string }>(
        `SELECT subject, description FROM tickets WHERE ticket_number = ?`,
        [message.ticketNumber],
      )
      const bodies = await all<{ body: string }>(
        `SELECT body FROM ticket_messages WHERE ticket_number = ?`,
        [message.ticketNumber],
      )

      await run(`DELETE FROM tickets_fts WHERE rowid = ?`, [message.ticketNumber])
      await run(`INSERT INTO tickets_fts (rowid, subject, description, body) VALUES (?, ?, ?, ?)`, [
        message.ticketNumber,
        existing?.subject ?? '',
        existing?.description ?? '',
        bodies.map((row) => row.body).join(' '),
      ])

      return { ...message, id } as TicketMessage
    },

    async listTicketMessages(ticketNumber, options = {}) {
      const values: unknown[] = [ticketNumber]
      const where = ['ticket_number = ?']

      if (options.cursor) {
        where.push(`seq > (SELECT seq FROM ticket_messages WHERE id = ?)`)
        values.push(options.cursor)
      }

      const limit = capLimit(options.limit)
      values.push(limit + 1)

      const rows = await all<TicketMessageRow>(
        `SELECT * FROM ticket_messages WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?`,
        values,
      )

      return toPage(rows.map(toTicketMessage), rows.length > limit, limit, (item) => item.id)
    },

    async createSource(record) {
      await run(
        `INSERT INTO sources (id, type, name, status, created_at, updated_at, content, url, pairs, chunks, characters, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.type,
          record.name,
          record.status,
          record.createdAt,
          record.updatedAt,
          record.content ?? null,
          record.url ?? null,
          json(record.pairs),
          record.chunks ?? null,
          record.characters ?? null,
          record.fetchedAt ?? null,
        ],
      )
      return record
    },

    async getSource(id) {
      const row = await first<SourceRow>(`SELECT * FROM sources WHERE id = ?`, [id])
      return row ? toSource(row) : null
    },

    async listSources(options = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (options.status) {
        where.push('status = ?')
        values.push(options.status)
      }
      if (options.cursor) {
        where.push(`(updated_at, id) < (SELECT updated_at, id FROM sources WHERE id = ?)`)
        values.push(options.cursor)
      }

      const limit = capLimit(options.limit)
      values.push(limit + 1)

      const rows = await all<SourceRow>(
        `SELECT * FROM sources
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
        values,
      )

      return toPage(rows.map(toSource), rows.length > limit, limit, (item) => item.id)
    },

    async updateSource(id, patch) {
      const sets = ['updated_at = ?']
      const values: unknown[] = [patch.updatedAt ?? new Date().toISOString()]

      for (const [key, column, encode] of [
        ['type', 'type', (v: unknown) => v],
        ['name', 'name', (v: unknown) => v],
        ['status', 'status', (v: unknown) => v],
        ['content', 'content', (v: unknown) => v ?? null],
        ['url', 'url', (v: unknown) => v ?? null],
        ['pairs', 'pairs', json],
        ['chunks', 'chunks', (v: unknown) => v ?? null],
        ['characters', 'characters', (v: unknown) => v ?? null],
        ['fetchedAt', 'fetched_at', (v: unknown) => v ?? null],
      ] as const) {
        if (patch[key] === undefined) continue
        sets.push(`${column} = ?`)
        values.push(encode(patch[key]))
      }

      values.push(id)
      await run(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`, values)

      const row = await first<SourceRow>(`SELECT * FROM sources WHERE id = ?`, [id])
      return row ? toSource(row) : null
    },

    async deleteSource(id) {
      await run(`UPDATE sources SET status = 'pending_deletion', updated_at = ? WHERE id = ?`, [
        new Date().toISOString(),
        id,
      ])
      const row = await first<SourceRow>(`SELECT * FROM sources WHERE id = ?`, [id])
      return row ? toSource(row) : null
    },

    async restoreSource(id) {
      await run(`UPDATE sources SET status = 'active', updated_at = ? WHERE id = ?`, [
        new Date().toISOString(),
        id,
      ])
      const row = await first<SourceRow>(`SELECT * FROM sources WHERE id = ?`, [id])
      return row ? toSource(row) : null
    },

    async purgeSources() {
      const doomed = await all<{ id: string }>(`SELECT id FROM sources WHERE status = 'pending_deletion'`)
      if (doomed.length === 0) return 0
      await run(`DELETE FROM sources WHERE status = 'pending_deletion'`)
      return doomed.length
    },

    async deleteConversation(conversationId: string) {
      const existing = await first<{ id: string }>(`SELECT id FROM conversations WHERE id = ?`, [
        conversationId,
      ])

      const statements = [
        db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).bind(conversationId),
        db.prepare(`DELETE FROM leads WHERE conversation_id = ?`).bind(conversationId),
        db.prepare(`DELETE FROM conversations WHERE id = ?`).bind(conversationId),
      ]

      // One batch where the binding offers one, because D1 runs a batch in a
      // transaction and a customer's messages must not be left behind by a
      // request that died between two deletes. The shim used by the tests has
      // no batch, so the fallback matters.
      if (db.batch) {
        await db.batch(statements)
      } else {
        for (const statement of statements) await statement.run()
      }

      return Boolean(existing)
    },
  }
}

/** Creates the tables. Safe to run repeatedly. */
export async function migrate(db: D1Like): Promise<void> {
  for (const statement of SCHEMA) {
    await db.prepare(statement).run()
  }
}

// ---- row mapping ------------------------------------------------------------

interface ConversationRow {
  id: string
  channel: string
  created_at: string
  updated_at: string
  contact: string | null
  ticket_id: string | null
  meta: string | null
}

interface MessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  sources: string | null
  actions: string | null
  attachments: string | null
  flags: string | null
  feedback: string | null
  unanswered: number
}

interface LeadRow {
  id: string
  conversation_id: string | null
  created_at: string
  values_json: string
}

interface TicketRow {
  ticket_number: number
  subject: string
  description: string
  status_id: string
  status_category: string
  assignee_id: string | null
  team_id: string | null
  customer: string
  channel: string
  conversation_id: string | null
  metadata: string
  created_at: string
  updated_at: string
  last_message_at: string | null
}

interface TicketMessageRow {
  id: string
  ticket_number: number
  type: string
  body: string
  sender: string
  created_at: string
  meta: string | null
}

interface SourceRow {
  id: string
  type: string
  name: string
  status: string
  created_at: string
  updated_at: string
  content: string | null
  url: string | null
  pairs: string | null
  chunks: number | null
  characters: number | null
  fetched_at: string | null
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    channel: row.channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.contact ? { contact: parse(row.contact) as Conversation['contact'] } : {}),
    ...(row.ticket_id ? { ticketId: row.ticket_id } : {}),
    ...(row.meta ? { meta: parse(row.meta) as Record<string, unknown> } : {}),
  }
}

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    ...(row.sources ? { sources: parse(row.sources) as StoredMessage['sources'] } : {}),
    ...(row.actions ? { actions: parse(row.actions) as StoredMessage['actions'] } : {}),
    ...(row.attachments ? { attachments: parse(row.attachments) as StoredMessage['attachments'] } : {}),
    ...(row.flags ? { flags: parse(row.flags) as StoredMessage['flags'] } : {}),
    ...(row.feedback ? { feedback: row.feedback as 'positive' | 'negative' } : {}),
    ...(row.unanswered ? { unanswered: true } : {}),
  }
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    createdAt: row.created_at,
    values: (parse(row.values_json) ?? {}) as Record<string, unknown>,
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
  }
}

function toTicket(row: TicketRow): Ticket {
  return {
    ticketNumber: Number(row.ticket_number),
    subject: row.subject,
    description: row.description,
    statusId: row.status_id,
    statusCategory: row.status_category as Ticket['statusCategory'],
    customer: (parse(row.customer) ?? {}) as Ticket['customer'],
    channel: row.channel,
    metadata: (parse(row.metadata) ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.assignee_id ? { assigneeId: row.assignee_id } : {}),
    ...(row.team_id ? { teamId: row.team_id } : {}),
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    ...(row.last_message_at ? { lastMessageAt: row.last_message_at } : {}),
  }
}

function toTicketMessage(row: TicketMessageRow): TicketMessage {
  return {
    id: row.id,
    ticketNumber: Number(row.ticket_number),
    type: row.type as TicketMessage['type'],
    sender: (parse(row.sender) ?? {}) as TicketMessage['sender'],
    content: row.body,
    createdAt: row.created_at,
    ...(row.meta ? { metadata: parse(row.meta) as Record<string, unknown> } : {}),
  }
}

function toSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    type: row.type as SourceRecord['type'],
    name: row.name,
    status: row.status as SourceRecord['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.content !== null ? { content: row.content } : {}),
    ...(row.url !== null ? { url: row.url } : {}),
    ...(row.pairs ? { pairs: parse(row.pairs) as SourceRecord['pairs'] } : {}),
    ...(row.chunks !== null ? { chunks: row.chunks } : {}),
    ...(row.characters !== null ? { characters: row.characters } : {}),
    ...(row.fetched_at ? { fetchedAt: row.fetched_at } : {}),
  }
}

// ---- helpers ----------------------------------------------------------------

function toPage<T>(items: T[], hasMore: boolean, limit: number, idOf: (item: T) => string): Page<T> {
  const page = items.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page, ...(hasMore && last ? { cursor: idOf(last) } : {}) }
}

function capLimit(limit: number | undefined): number {
  // The floor matters as much as the ceiling. A negative number reaching a
  // `LIMIT` clause means "no limit" in SQLite and is an error in Postgres,
  // while the in-memory stores read it as "all but the last row": three
  // answers to one mistake. `pageSize` is where that is decided for all four.
  return pageSize(limit, DEFAULT_LIMIT, MAX_LIMIT)
}

/** SQLite has no JSON type, so everything nested is stored as text. */
function json(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

function parse(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    // A row written by something else is not a reason to fail a read.
    return null
  }
}

export type { ListOptions }
