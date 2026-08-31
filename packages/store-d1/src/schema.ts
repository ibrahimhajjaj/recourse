/**
 * The schema, as SQLite rather than Postgres.
 *
 * The differences from `@recourse-ai/store-postgres` are all forced by D1:
 *
 * - `INTEGER PRIMARY KEY AUTOINCREMENT` instead of a sequence. It still fixes
 *   the ticket-number race, by a different mechanism: SQLite assigns it inside
 *   the insert rather than the application reading the highest and adding one.
 * - JSON lives in TEXT columns. SQLite has JSON functions but no JSON type,
 *   and everything here is read whole rather than queried into.
 * - FTS5 for ticket search, which is SQLite's full-text engine and needs its
 *   own virtual table plus triggers to stay in step.
 * - No advisory lock around migration. A D1 database is a single Durable
 *   Object and processes one statement at a time, so the race the Postgres
 *   version had to guard cannot happen here.
 */

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversations (
     id          TEXT PRIMARY KEY,
     channel     TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     contact     TEXT,
     ticket_id   TEXT,
     meta        TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS messages (
     seq             INTEGER PRIMARY KEY AUTOINCREMENT,
     id              TEXT NOT NULL,
     conversation_id TEXT NOT NULL,
     role            TEXT NOT NULL,
     content         TEXT NOT NULL,
     created_at      TEXT NOT NULL,
     sources         TEXT,
     actions         TEXT,
     attachments     TEXT,
     flags           TEXT,
     feedback        TEXT,
     unanswered      INTEGER NOT NULL DEFAULT 0,
     UNIQUE (conversation_id, id)
   )`,

  `CREATE TABLE IF NOT EXISTS leads (
     id              TEXT PRIMARY KEY,
     conversation_id TEXT,
     created_at      TEXT NOT NULL,
     values_json     TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS tickets (
     ticket_number   INTEGER PRIMARY KEY AUTOINCREMENT,
     subject         TEXT NOT NULL,
     description     TEXT NOT NULL,
     status_id       TEXT NOT NULL,
     status_category TEXT NOT NULL,
     assignee_id     TEXT,
     team_id         TEXT,
     customer        TEXT NOT NULL,
     channel         TEXT NOT NULL,
     conversation_id TEXT,
     metadata        TEXT NOT NULL DEFAULT '{}',
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     last_message_at TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS ticket_messages (
     seq           INTEGER PRIMARY KEY AUTOINCREMENT,
     id            TEXT NOT NULL UNIQUE,
     ticket_number INTEGER NOT NULL,
     type          TEXT NOT NULL,
     body          TEXT NOT NULL,
     sender        TEXT NOT NULL,
     created_at    TEXT NOT NULL,
     meta          TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS sources (
     id          TEXT PRIMARY KEY,
     type        TEXT NOT NULL,
     name        TEXT NOT NULL,
     status      TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     content     TEXT,
     url         TEXT,
     pairs       TEXT,
     chunks      INTEGER,
     characters  INTEGER,
     fetched_at  TEXT
   )`,

  `CREATE INDEX IF NOT EXISTS conversations_updated ON conversations (updated_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS conversations_channel ON conversations (channel, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, seq)`,
  `CREATE INDEX IF NOT EXISTS leads_created ON leads (created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS tickets_updated ON tickets (updated_at DESC, ticket_number DESC)`,
  `CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status_category, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages (ticket_number, seq)`,
  `CREATE INDEX IF NOT EXISTS sources_status ON sources (status, updated_at DESC)`,

  // Full-text over what somebody actually searches a ticket by.
  //
  // A normal FTS5 table, not a contentless one. Contentless (`content=''`)
  // stores no second copy of the text, which sounded right against a 10GB
  // ceiling until it turned out contentless tables cannot be deleted from,
  // and every ticket edit needs to replace its row. Ticket text is not what
  // fills a database anyway; chunks and vectors are.
  `CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(subject, description, body)`,
]
