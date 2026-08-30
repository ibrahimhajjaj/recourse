/**
 * The Store, backed by Postgres.
 *
 * `memoryStore` dies with the process and `fileStore` assumes one writer. Any
 * serverless deployment runs more than one instance under load, and today that
 * means transcripts, tickets and sources scattered across instances that
 * cannot see each other. This is the swap the Store interface was shaped for.
 *
 * `pg` is a peer dependency, so the core keeps its two-dependency install and
 * only people who want a database download a driver.
 */

import { createRequire } from 'node:module'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
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
} from 'helpdeck'
import { SCHEMA } from './schema.js'

export interface PostgresStoreOptions {
  /** An existing pool. Preferred: one pool per process, not one per store. */
  pool?: Pool
  /** Built into a pool when no pool is given. */
  connectionString?: string
  /**
   * Connections this pool may open. Ten by default.
   *
   * Do not set this to 1 to be safe on serverless. It does not reduce the
   * total, because the total is instances times pool size and you cannot
   * control the first number; it only removes concurrency inside each
   * instance. Reach for a pooler in front of the database instead.
   */
  max?: number
  /**
   * How long an unused connection is kept, in milliseconds. Five seconds by
   * default, short on purpose: see the note on suspension below.
   */
  idleTimeoutMillis?: number
  /**
   * Creates the tables on first use.
   *
   * On by default because the alternative is a store that throws on its first
   * write until someone reads the README. Turn it off where migrations are
   * owned by something else, or where the application's role cannot DDL.
   */
  migrate?: boolean
}

/** Same caps as every other implementation, so paging behaves identically. */
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function postgresStore(options: PostgresStoreOptions): Store {
  const pool = resolvePool(options)
  const shouldMigrate = options.migrate !== false

  // One migration per store, awaited by everything that touches the database.
  // Racing callers share the same promise rather than each running the DDL.
  let migrated: Promise<void> | null = null
  async function ready(): Promise<Pool> {
    if (!shouldMigrate) return pool
    migrated ??= migrate(pool)
    await migrated
    return pool
  }

  async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    const db = await ready()
    const result = await db.query<T>(text, values)
    return result.rows
  }

  /**
   * Everything in one transaction, or nothing.
   *
   * `pool.query` may land each statement on a different connection, so a
   * transaction has to hold one client for its whole life.
   */
  async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const db = await ready()
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  return {
    name: 'postgres',

    async appendMessage(conversationId, message, conversation) {
      const now = new Date().toISOString()

      await transaction(async (client) => {
        // The conversation is created by whichever message arrives first, and
        // updated by every one after. `updated_at` is what the list is sorted
        // by, so it moves on every message rather than only on creation.
        await client.query(
          // The channel defaults to 'web' only when the conversation is being
          // created. On a later message the parameter is null and the stored
          // channel stands: a WhatsApp thread whose second message arrives
          // without the conversation argument is still a WhatsApp thread.
          `INSERT INTO conversations (id, channel, created_at, updated_at, contact, ticket_id, meta)
           VALUES ($1, COALESCE($2::text, 'web'), $3, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             updated_at = EXCLUDED.updated_at,
             channel    = COALESCE($2::text, conversations.channel),
             contact    = COALESCE(EXCLUDED.contact, conversations.contact),
             ticket_id  = COALESCE(EXCLUDED.ticket_id, conversations.ticket_id),
             meta       = COALESCE(EXCLUDED.meta, conversations.meta)`,
          [
            conversationId,
            conversation?.channel ?? null,
            message.createdAt ?? now,
            json(conversation?.contact),
            conversation?.ticketId ?? null,
            json(conversation?.meta),
          ],
        )

        await client.query(
          `INSERT INTO messages
             (id, conversation_id, role, content, created_at, sources, actions, attachments, feedback, unanswered)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (conversation_id, id) DO NOTHING`,
          [
            message.id,
            conversationId,
            message.role,
            message.content,
            message.createdAt ?? now,
            json(message.sources),
            json(message.actions),
            json(message.attachments),
            message.feedback ?? null,
            message.unanswered ?? false,
          ],
        )
      })
    },

    async getConversation(id) {
      const [conversation] = await query<ConversationRow>(
        `SELECT * FROM conversations WHERE id = $1`,
        [id],
      )
      if (!conversation) return null

      const messages = await query<MessageRow>(
        `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq ASC`,
        [id],
      )

      return { conversation: toConversation(conversation), messages: messages.map(toMessage) }
    },

    async listConversations(options = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (options.channel) {
        values.push(options.channel)
        where.push(`c.channel = $${values.length}`)
      }
      if (options.since) {
        values.push(options.since)
        where.push(`c.updated_at >= $${values.length}`)
      }
      if (options.until) {
        values.push(options.until)
        where.push(`c.updated_at <= $${values.length}`)
      }
      if (options.unansweredOnly) {
        where.push(`EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.unanswered)`)
      }
      if (options.cursor) {
        // The cursor is the previous page's last id, which is the contract the
        // in-memory store set. Resolving it to its sort position keeps the two
        // interchangeable, so a cursor does not break when the store is
        // swapped underneath a running client.
        values.push(options.cursor)
        where.push(
          `(c.updated_at, c.id) < (SELECT updated_at, id FROM conversations WHERE id = $${values.length})`,
        )
      }

      const limit = capLimit(options.limit)
      values.push(limit + 1)

      const rows = await query<ConversationRow>(
        `SELECT c.* FROM conversations c
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT $${values.length}`,
        values,
      )

      return toPage(rows.map(toConversation), rows.length > limit, limit, (item) => item.id)
    },

    async updateConversation(id, patch) {
      const sets: string[] = ['updated_at = $2']
      const values: unknown[] = [id, new Date().toISOString()]

      if (patch.channel !== undefined) {
        values.push(patch.channel)
        sets.push(`channel = $${values.length}`)
      }
      if (patch.contact !== undefined) {
        values.push(json(patch.contact))
        sets.push(`contact = $${values.length}`)
      }
      if (patch.ticketId !== undefined) {
        values.push(patch.ticketId)
        sets.push(`ticket_id = $${values.length}`)
      }
      if (patch.meta !== undefined) {
        values.push(json(patch.meta))
        sets.push(`meta = $${values.length}`)
      }

      await query(`UPDATE conversations SET ${sets.join(', ')} WHERE id = $1`, values)
    },

    async setFeedback(conversationId, messageId, feedback) {
      await query(
        `UPDATE messages SET feedback = $3 WHERE conversation_id = $1 AND id = $2`,
        [conversationId, messageId, feedback],
      )
    },

    async saveLead(lead) {
      await query(
        `INSERT INTO leads (id, conversation_id, created_at, values)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET values = EXCLUDED.values`,
        [lead.id, lead.conversationId ?? null, lead.createdAt, json(lead.values) ?? '{}'],
      )
    },

    async listLeads(options = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (options.since) {
        values.push(options.since)
        where.push(`created_at >= $${values.length}`)
      }
      if (options.until) {
        values.push(options.until)
        where.push(`created_at <= $${values.length}`)
      }
      if (options.cursor) {
        values.push(options.cursor)
        where.push(`(created_at, id) < (SELECT created_at, id FROM leads WHERE id = $${values.length})`)
      }

      const limit = capLimit(options.limit)
      values.push(limit + 1)

      const rows = await query<LeadRow>(
        `SELECT * FROM leads
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id DESC
         LIMIT $${values.length}`,
        values,
      )

      return toPage(rows.map(toLead), rows.length > limit, limit, (item) => item.id)
    },

    async stats(options = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (options.channel) {
        values.push(options.channel)
        where.push(`c.channel = $${values.length}`)
      }
      if (options.since) {
        values.push(options.since)
        where.push(`c.updated_at >= $${values.length}`)
      }
      if (options.until) {
        values.push(options.until)
        where.push(`c.updated_at <= $${values.length}`)
      }

      const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

      // One round trip. These are read together on every dashboard load, and
      // five queries would be five times the latency for the same numbers.
      const [row] = await query<StatsRow>(
        `WITH scoped AS (SELECT c.* FROM conversations c ${filter}),
              threads AS (
                SELECT m.*,
                       LAG(m.content) OVER (PARTITION BY m.conversation_id ORDER BY m.seq) AS previous_content,
                       LAG(m.role)    OVER (PARTITION BY m.conversation_id ORDER BY m.seq) AS previous_role
                FROM messages m
                JOIN scoped s ON s.id = m.conversation_id
              ),
              people AS (
                SELECT t.created_at AS at,
                       -- Identity where there is one, the conversation
                       -- otherwise: an anonymous visitor is a person.
                       coalesce(
                         nullif(s.contact->>'id', ''),
                         nullif(s.contact->>'email', ''),
                         s.id
                       ) AS who
                FROM threads t
                JOIN scoped s ON s.id = t.conversation_id
                WHERE t.role = 'user'
              ),
              newest AS (SELECT max(at) AS newest FROM people)
         SELECT
           (SELECT count(*) FROM scoped)::int AS conversations,
           (SELECT count(*) FROM threads)::int AS messages,
           (SELECT count(*) FROM threads WHERE unanswered)::int AS unanswered,
           (SELECT count(*) FROM threads WHERE feedback = 'positive')::int AS thumbs_up,
           (SELECT count(*) FROM threads WHERE feedback = 'negative')::int AS thumbs_down,
           (SELECT count(*) FROM leads ${leadFilter(options, values)})::int AS leads,
           (SELECT coalesce(jsonb_object_agg(channel, total), '{}'::jsonb)
              FROM (SELECT channel, count(*)::int AS total FROM scoped GROUP BY channel) AS byc
           ) AS by_channel,
           (SELECT coalesce(jsonb_agg(gap ORDER BY (gap->>'count')::int DESC), '[]'::jsonb)
              FROM (
                SELECT jsonb_build_object('question', question, 'count', count(*)::int) AS gap
                FROM (
                  -- The question is the user turn that produced the unanswered
                  -- reply, matching the shared implementation exactly: trimmed,
                  -- lowercased, first 120 characters.
                  SELECT left(lower(btrim(
                           CASE WHEN previous_role = 'user' THEN previous_content ELSE content END
                         )), 120) AS question
                  FROM threads
                  WHERE unanswered
                ) AS questions
                WHERE question <> ''
                GROUP BY question
                ORDER BY count(*) DESC
                LIMIT 20
              ) AS gaps
           ) AS top_gaps,
           -- A day is a day in UTC, the same slice the shared implementation
           -- takes off the front of the timestamp, so the two never disagree
           -- about which side of midnight something fell.
           (SELECT coalesce(
                     jsonb_agg(jsonb_build_object('date', d, 'conversations', c, 'messages', m) ORDER BY d),
                     '[]'::jsonb)
              FROM (
                SELECT d, sum(c)::int AS c, sum(m)::int AS m
                FROM (
                  SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, 1 AS c, 0 AS m FROM scoped
                  UNION ALL
                  SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 0, 1 FROM threads
                ) AS rows
                GROUP BY d
              ) AS perday
           ) AS daily,
           (SELECT coalesce(jsonb_object_agg(name, total), '{}'::jsonb)
              FROM (
                SELECT act->>'name' AS name, count(*)::int AS total
                FROM threads, jsonb_array_elements(coalesce(actions, '[]'::jsonb)) AS act
                GROUP BY 1 ORDER BY 2 DESC
              ) AS acts
           ) AS by_action,
           (SELECT coalesce(jsonb_object_agg(country, total), '{}'::jsonb)
              FROM (
                SELECT meta->>'country' AS country, count(*)::int AS total
                FROM scoped WHERE coalesce(meta->>'country', '') <> ''
                GROUP BY 1
              ) AS places
           ) AS by_country,
           -- Both windows end at the newest user turn rather than at now(), so
           -- the same rows always give the same answer.
           (SELECT count(DISTINCT who)::int FROM people
             WHERE at > (SELECT newest FROM newest) - interval '1 day') AS active_daily,
           (SELECT count(DISTINCT who)::int FROM people
             WHERE at > (SELECT newest FROM newest) - interval '7 days') AS active_weekly`,
        values,
      )

      return toStats(row)
    },

    async createTicket(ticket) {
      const [row] = await query<TicketRow>(
        `INSERT INTO tickets
           (subject, description, status_id, status_category, assignee_id, team_id,
            customer, channel, conversation_id, metadata, created_at, updated_at, last_message_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
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

      return toTicket(row as TicketRow)
    },

    async getTicket(ticketNumber) {
      const [row] = await query<TicketRow>(`SELECT * FROM tickets WHERE ticket_number = $1`, [ticketNumber])
      return row ? toTicket(row) : null
    },

    async listTickets(filter = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (filter.statusCategory) {
        const categories = Array.isArray(filter.statusCategory) ? filter.statusCategory : [filter.statusCategory]
        values.push(categories)
        where.push(`status_category = ANY($${values.length})`)
      }
      if (filter.statusId) {
        values.push(filter.statusId)
        where.push(`status_id = $${values.length}`)
      }
      if (filter.assigneeId === null) {
        // Explicitly unassigned, which is a different question from "any".
        where.push(`assignee_id IS NULL`)
      } else if (filter.assigneeId !== undefined) {
        values.push(filter.assigneeId)
        where.push(`assignee_id = $${values.length}`)
      }
      if (filter.teamId) {
        values.push(filter.teamId)
        where.push(`team_id = $${values.length}`)
      }
      if (filter.channel) {
        values.push(filter.channel)
        where.push(`channel = $${values.length}`)
      }
      if (filter.openOnly) {
        where.push(`status_category NOT IN ('closed', 'cancelled')`)
      }
      if (filter.since) {
        values.push(filter.since)
        where.push(`updated_at >= $${values.length}`)
      }
      if (filter.until) {
        values.push(filter.until)
        where.push(`updated_at <= $${values.length}`)
      }
      if (filter.cursor) {
        values.push(Number(filter.cursor))
        where.push(
          `(updated_at, ticket_number) < (SELECT updated_at, ticket_number FROM tickets WHERE ticket_number = $${values.length})`,
        )
      }

      const limit = capLimit(filter.limit)
      values.push(limit + 1)

      const rows = await query<TicketRow>(
        `SELECT * FROM tickets
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY updated_at DESC, ticket_number DESC
         LIMIT $${values.length}`,
        values,
      )

      return toPage(rows.map(toTicket), rows.length > limit, limit, (item) => String(item.ticketNumber))
    },

    async updateTicket(ticketNumber, patch) {
      const sets: string[] = ['updated_at = $2']
      const values: unknown[] = [ticketNumber, patch.updatedAt ?? new Date().toISOString()]

      const columns: Array<[keyof Ticket, string, (value: unknown) => unknown]> = [
        ['subject', 'subject', (v) => v],
        ['description', 'description', (v) => v],
        ['statusId', 'status_id', (v) => v],
        ['statusCategory', 'status_category', (v) => v],
        ['assigneeId', 'assignee_id', (v) => v ?? null],
        ['teamId', 'team_id', (v) => v ?? null],
        ['customer', 'customer', (v) => json(v)],
        ['channel', 'channel', (v) => v],
        ['conversationId', 'conversation_id', (v) => v ?? null],
        ['metadata', 'metadata', (v) => json(v)],
        ['lastMessageAt', 'last_message_at', (v) => v ?? null],
      ]

      for (const [key, column, encode] of columns) {
        if (patch[key] === undefined) continue
        values.push(encode(patch[key]))
        sets.push(`${column} = $${values.length}`)
      }

      const [row] = await query<TicketRow>(
        `UPDATE tickets SET ${sets.join(', ')} WHERE ticket_number = $1 RETURNING *`,
        values,
      )

      return row ? toTicket(row) : null
    },

    async searchTickets(search, limit = 20) {
      const term = search.trim()
      if (!term) return []

      // `plainto_tsquery` rather than `to_tsquery`: a customer's search box
      // contains apostrophes and ampersands, and the strict parser throws on
      // them rather than returning nothing.
      const rows = await query<TicketRow>(
        `SELECT t.* FROM tickets t
         WHERE t.search @@ plainto_tsquery('simple', $1)
            OR EXISTS (
                 SELECT 1 FROM ticket_messages m
                 WHERE m.ticket_number = t.ticket_number
                   AND to_tsvector('simple', coalesce(m.body, '')) @@ plainto_tsquery('simple', $1)
               )
         ORDER BY t.updated_at DESC, t.ticket_number DESC
         LIMIT $2`,
        [term, Math.min(limit, MAX_LIMIT)],
      )

      return rows.map(toTicket)
    },

    async addTicketMessage(message) {
      const id = `tm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

      const [row] = await query<TicketMessageRow>(
        `INSERT INTO ticket_messages (id, ticket_number, type, body, sender, created_at, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
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

      return toTicketMessage(row as TicketMessageRow)
    },

    async listTicketMessages(ticketNumber, options = {}) {
      const values: unknown[] = [ticketNumber]
      const where = [`ticket_number = $1`]

      if (options.cursor) {
        values.push(options.cursor)
        where.push(`seq > (SELECT seq FROM ticket_messages WHERE id = $${values.length})`)
      }

      const limit = capLimit(options.limit)
      values.push(limit + 1)

      const rows = await query<TicketMessageRow>(
        `SELECT * FROM ticket_messages
         WHERE ${where.join(' AND ')}
         ORDER BY seq ASC
         LIMIT $${values.length}`,
        values,
      )

      return toPage(rows.map(toTicketMessage), rows.length > limit, limit, (item) => item.id)
    },

    async createSource(record) {
      const [row] = await query<SourceRow>(
        `INSERT INTO sources
           (id, type, name, status, created_at, updated_at, content, url, pairs, chunks, characters, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
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

      return toSource(row as SourceRow)
    },

    async getSource(id) {
      const [row] = await query<SourceRow>(`SELECT * FROM sources WHERE id = $1`, [id])
      return row ? toSource(row) : null
    },

    async listSources(options = {}) {
      const where: string[] = []
      const values: unknown[] = []

      if (options.status) {
        values.push(options.status)
        where.push(`status = $${values.length}`)
      }
      if (options.cursor) {
        values.push(options.cursor)
        where.push(`(updated_at, id) < (SELECT updated_at, id FROM sources WHERE id = $${values.length})`)
      }

      const limit = capLimit(options.limit)
      values.push(limit + 1)

      const rows = await query<SourceRow>(
        `SELECT * FROM sources
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY updated_at DESC, id DESC
         LIMIT $${values.length}`,
        values,
      )

      return toPage(rows.map(toSource), rows.length > limit, limit, (item) => item.id)
    },

    async updateSource(id, patch) {
      const sets: string[] = ['updated_at = $2']
      const values: unknown[] = [id, patch.updatedAt ?? new Date().toISOString()]

      const columns: Array<[keyof SourceRecord, string, (value: unknown) => unknown]> = [
        ['type', 'type', (v) => v],
        ['name', 'name', (v) => v],
        ['status', 'status', (v) => v],
        ['content', 'content', (v) => v ?? null],
        ['url', 'url', (v) => v ?? null],
        ['pairs', 'pairs', (v) => json(v)],
        ['chunks', 'chunks', (v) => v ?? null],
        ['characters', 'characters', (v) => v ?? null],
        ['fetchedAt', 'fetched_at', (v) => v ?? null],
      ]

      for (const [key, column, encode] of columns) {
        if (patch[key] === undefined) continue
        values.push(encode(patch[key]))
        sets.push(`${column} = $${values.length}`)
      }

      const [row] = await query<SourceRow>(
        `UPDATE sources SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        values,
      )

      return row ? toSource(row) : null
    },

    async deleteSource(id) {
      const [row] = await query<SourceRow>(
        `UPDATE sources SET status = 'pending_deletion', updated_at = $2 WHERE id = $1 RETURNING *`,
        [id, new Date().toISOString()],
      )
      return row ? toSource(row) : null
    },

    async restoreSource(id) {
      const [row] = await query<SourceRow>(
        `UPDATE sources SET status = 'active', updated_at = $2 WHERE id = $1 RETURNING *`,
        [id, new Date().toISOString()],
      )
      return row ? toSource(row) : null
    },

    async purgeSources() {
      const rows = await query<{ id: string }>(
        `DELETE FROM sources WHERE status = 'pending_deletion' RETURNING id`,
      )
      return rows.length
    },

    async deleteConversation(conversationId: string) {
      // One statement, so there is no window in which the conversation is gone
      // and the customer's words are not.
      //
      // `messages` carries ON DELETE CASCADE and looks after itself. `leads`
      // does not: its `conversation_id` is a plain column, because a lead can
      // outlive the conversation that produced it and a foreign key would stop
      // that. So it is deleted here, explicitly, in the same statement.
      const rows = await query<{ id: string }>(
        `WITH forgotten AS (DELETE FROM leads WHERE conversation_id = $1)
         DELETE FROM conversations WHERE id = $1 RETURNING id`,
        [conversationId],
      )

      return rows.length > 0
    },
  }
}

/** Creates the tables. Safe to run repeatedly and from several processes. */
export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    // `IF NOT EXISTS` is not atomic: two sessions can both see the table
    // missing and both try to create it, and one gets a duplicate key error
    // from the catalogue. That is exactly what happens when several serverless
    // instances start at once, which is the deployment this package is for.
    // The advisory lock is transaction-scoped, so it is released by the COMMIT
    // whatever happens.
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK])
    for (const statement of SCHEMA) await client.query(statement)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** An arbitrary constant. It only has to be the same in every instance. */
const MIGRATION_LOCK = 8_273_461_902

/**
 * Pools built here, so the same mistake is not made in every application.
 *
 * The defaults are chosen for the deployment this package exists for: many
 * short-lived instances sharing one database.
 */
function resolvePool(options: PostgresStoreOptions): Pool {
  if (options.pool) return options.pool
  if (!options.connectionString) {
    throw new Error('postgresStore needs a pool or a connectionString')
  }

  warnOnRepeatedPool(options.connectionString)

  // Required lazily so importing this module does not pull in the driver for
  // anyone who only wanted the types.
  const require_ = createRequire(import.meta.url)
  const { Pool: PgPool } = require_('pg') as typeof import('pg')

  return new PgPool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    // Short, because a suspended serverless instance does not run its idle
    // timers: connections opened before a suspension stay open until the
    // instance dies or the database gives up on them. A five second timeout
    // means far fewer of them are idle when the suspension lands.
    idleTimeoutMillis: options.idleTimeoutMillis ?? 5_000,
    // Fail rather than hang. A request waiting forever on a connection is a
    // request the customer has already given up on.
    connectionTimeoutMillis: 10_000,
    // Lets a script or a test process exit instead of being held open by an
    // idle connection nobody is going to use.
    allowExitOnIdle: true,
  })
}

/**
 * Catches the mistake that actually exhausts a database.
 *
 * It is not pool size, it is building a store per request: every call opens
 * another pool, none of them are ever closed, and the connection count climbs
 * until the database refuses. Warned once, because a warning on every request
 * is just more noise in a log nobody can read.
 */
const pooledConnections = new Set<string>()
let warned = false

function warnOnRepeatedPool(connectionString: string): void {
  if (pooledConnections.has(connectionString) && !warned) {
    warned = true
    console.warn(
      '[helpdeck] postgresStore has opened a second pool for the same database in this process. ' +
        'Create the store once at module scope and reuse it; one per request will exhaust the ' +
        'connection limit. Pass an existing `pool` if you manage one yourself.',
    )
  }
  pooledConnections.add(connectionString)
}

// ---- row mapping ------------------------------------------------------------

interface ConversationRow {
  id: string
  channel: string
  created_at: Date
  updated_at: Date
  contact: unknown
  ticket_id: string | null
  meta: unknown
}

interface MessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: Date
  sources: unknown
  actions: unknown
  attachments: unknown
  feedback: string | null
  unanswered: boolean
}

interface LeadRow {
  id: string
  conversation_id: string | null
  created_at: Date
  values: Record<string, unknown>
}

interface TicketRow {
  ticket_number: string | number
  subject: string
  description: string
  status_id: string
  status_category: string
  assignee_id: string | null
  team_id: string | null
  customer: unknown
  channel: string
  conversation_id: string | null
  metadata: Record<string, unknown>
  created_at: Date
  updated_at: Date
  last_message_at: Date | null
}

interface TicketMessageRow {
  id: string
  ticket_number: string | number
  type: string
  body: string
  sender: unknown
  created_at: Date
  meta: unknown
}

interface SourceRow {
  id: string
  type: string
  name: string
  status: string
  created_at: Date
  updated_at: Date
  content: string | null
  url: string | null
  pairs: unknown
  chunks: number | null
  characters: number | null
  fetched_at: Date | null
}

interface StatsRow {
  conversations: number
  messages: number
  unanswered: number
  thumbs_up: number
  thumbs_down: number
  leads: number
  by_channel: Record<string, number>
  top_gaps: Array<{ question: string; count: number }>
  daily: Array<{ date: string; conversations: number; messages: number }>
  by_action: Record<string, number>
  active_daily: number
  active_weekly: number
  by_country: Record<string, number>
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    channel: row.channel,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.contact ? { contact: row.contact as Conversation['contact'] } : {}),
    ...(row.ticket_id ? { ticketId: row.ticket_id } : {}),
    ...(row.meta ? { meta: row.meta as Record<string, unknown> } : {}),
  }
}

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: iso(row.created_at),
    ...(row.sources ? { sources: row.sources as StoredMessage['sources'] } : {}),
    ...(row.actions ? { actions: row.actions as StoredMessage['actions'] } : {}),
    ...(row.attachments ? { attachments: row.attachments as StoredMessage['attachments'] } : {}),
    ...(row.feedback ? { feedback: row.feedback as 'positive' | 'negative' } : {}),
    ...(row.unanswered ? { unanswered: true } : {}),
  }
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    createdAt: iso(row.created_at),
    values: row.values ?? {},
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
  }
}

function toTicket(row: TicketRow): Ticket {
  return {
    // BIGINT arrives as a string, because it can exceed a JS number. Ticket
    // numbers will not, and the interface says number.
    ticketNumber: Number(row.ticket_number),
    subject: row.subject,
    description: row.description,
    statusId: row.status_id,
    statusCategory: row.status_category as Ticket['statusCategory'],
    customer: (row.customer ?? {}) as Ticket['customer'],
    channel: row.channel,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.assignee_id ? { assigneeId: row.assignee_id } : {}),
    ...(row.team_id ? { teamId: row.team_id } : {}),
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    ...(row.last_message_at ? { lastMessageAt: iso(row.last_message_at) } : {}),
  }
}

function toTicketMessage(row: TicketMessageRow): TicketMessage {
  return {
    id: row.id,
    ticketNumber: Number(row.ticket_number),
    type: row.type as TicketMessage['type'],
    sender: (row.sender ?? {}) as TicketMessage['sender'],
    content: row.body,
    createdAt: iso(row.created_at),
    ...(row.meta ? { metadata: row.meta as Record<string, unknown> } : {}),
  }
}

function toSource(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    type: row.type as SourceRecord['type'],
    name: row.name,
    status: row.status as SourceRecord['status'],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.content !== null ? { content: row.content } : {}),
    ...(row.url !== null ? { url: row.url } : {}),
    ...(row.pairs ? { pairs: row.pairs as SourceRecord['pairs'] } : {}),
    ...(row.chunks !== null ? { chunks: row.chunks } : {}),
    ...(row.characters !== null ? { characters: row.characters } : {}),
    ...(row.fetched_at ? { fetchedAt: iso(row.fetched_at) } : {}),
  }
}

function toStats(row: StatsRow | undefined): Stats {
  return {
    conversations: row?.conversations ?? 0,
    messages: row?.messages ?? 0,
    unanswered: row?.unanswered ?? 0,
    leads: row?.leads ?? 0,
    thumbsUp: row?.thumbs_up ?? 0,
    thumbsDown: row?.thumbs_down ?? 0,
    byChannel: row?.by_channel ?? {},
    topGaps: row?.top_gaps ?? [],
    daily: row?.daily ?? [],
    // Re-sorted here because a jsonb object does not keep the order it was
    // built in, and the contract is most used first.
    byAction: Object.fromEntries(
      Object.entries(row?.by_action ?? {}).sort(([, a], [, b]) => b - a),
    ),
    byCountry: row?.by_country ?? {},
    activeUsers: {
      daily: row?.active_daily ?? 0,
      weekly: row?.active_weekly ?? 0,
      stickiness:
        !row?.active_weekly ? 0 : Math.round(((row.active_daily ?? 0) / row.active_weekly) * 100) / 100,
    },
  }
}

// ---- helpers ----------------------------------------------------------------

/**
 * Leads are filtered by their own timestamp rather than the conversation's, so
 * this appends to the same parameter list the surrounding query is building.
 */
function leadFilter(options: ListOptions, values: unknown[]): string {
  const where: string[] = []
  if (options.since) {
    values.push(options.since)
    where.push(`created_at >= $${values.length}`)
  }
  if (options.until) {
    values.push(options.until)
    where.push(`created_at <= $${values.length}`)
  }
  return where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
}

/**
 * Reads one row past the limit to learn whether there is a next page, then
 * drops it. `count(*)` on every list would be a second scan for one boolean.
 */
function toPage<T>(items: T[], hasMore: boolean, limit: number, idOf: (item: T) => string): Page<T> {
  const page = items.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page, ...(hasMore && last ? { cursor: idOf(last) } : {}) }
}

function capLimit(limit: number | undefined): number {
  return Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT)
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** `undefined` has to become SQL NULL, not the string "undefined". */
function json(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

export { SCHEMA } from './schema.js'
export { pgVectorStore, migrateVectors, type PgVectorStoreOptions } from './vectors.js'
