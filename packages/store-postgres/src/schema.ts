/**
 * The schema, as one idempotent statement list.
 *
 * No migration framework. There is one version of this schema so far, and a
 * framework for that is more moving parts than the thing it manages. When
 * there is a second version there will be a second file and a version table;
 * pretending to need one now would be cargo cult.
 */

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversations (
     id          TEXT PRIMARY KEY,
     channel     TEXT NOT NULL,
     created_at  TIMESTAMPTZ NOT NULL,
     updated_at  TIMESTAMPTZ NOT NULL,
     contact     JSONB,
     ticket_id   TEXT,
     meta        JSONB
   )`,

  `CREATE TABLE IF NOT EXISTS messages (
     id              TEXT NOT NULL,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role            TEXT NOT NULL,
     content         TEXT NOT NULL,
     created_at      TIMESTAMPTZ NOT NULL,
     -- Ordering within a conversation. Timestamps collide: two messages in the
     -- same turn are written in the same millisecond, and a transcript that
     -- renders the answer above the question is worse than no transcript.
     seq             BIGSERIAL,
     sources         JSONB,
     actions         JSONB,
     attachments     JSONB,
     feedback        TEXT,
     unanswered      BOOLEAN NOT NULL DEFAULT FALSE,
     PRIMARY KEY (conversation_id, id)
   )`,

  `CREATE TABLE IF NOT EXISTS leads (
     id              TEXT PRIMARY KEY,
     conversation_id TEXT,
     created_at      TIMESTAMPTZ NOT NULL,
     values          JSONB NOT NULL
   )`,

  // The sequence is the whole point of this table. fileStore reads the highest
  // number and adds one, so two instances opening a ticket at the same moment
  // hand out the same number. A sequence cannot do that.
  `CREATE SEQUENCE IF NOT EXISTS ticket_number_seq AS BIGINT START 1`,

  `CREATE TABLE IF NOT EXISTS tickets (
     ticket_number   BIGINT PRIMARY KEY DEFAULT nextval('ticket_number_seq'),
     subject         TEXT NOT NULL,
     description     TEXT NOT NULL,
     status_id       TEXT NOT NULL,
     status_category TEXT NOT NULL,
     assignee_id     TEXT,
     team_id         TEXT,
     customer        JSONB NOT NULL,
     channel         TEXT NOT NULL,
     conversation_id TEXT,
     metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at      TIMESTAMPTZ NOT NULL,
     updated_at      TIMESTAMPTZ NOT NULL,
     last_message_at TIMESTAMPTZ
   )`,

  `CREATE TABLE IF NOT EXISTS ticket_messages (
     id            TEXT PRIMARY KEY,
     ticket_number BIGINT NOT NULL REFERENCES tickets(ticket_number) ON DELETE CASCADE,
     type          TEXT NOT NULL,
     body          TEXT NOT NULL,
     sender        JSONB NOT NULL,
     created_at    TIMESTAMPTZ NOT NULL,
     seq           BIGSERIAL,
     meta          JSONB
   )`,

  `CREATE TABLE IF NOT EXISTS sources (
     id          TEXT PRIMARY KEY,
     type        TEXT NOT NULL,
     name        TEXT NOT NULL,
     status      TEXT NOT NULL,
     created_at  TIMESTAMPTZ NOT NULL,
     updated_at  TIMESTAMPTZ NOT NULL,
     content     TEXT,
     url         TEXT,
     pairs       JSONB,
     chunks      INTEGER,
     characters  INTEGER,
     fetched_at  TIMESTAMPTZ
   )`,

  // Keyset pagination reads (updated_at, id) together, so the index carries
  // both or every page is a sort of the whole table.
  `CREATE INDEX IF NOT EXISTS conversations_updated ON conversations (updated_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS conversations_channel ON conversations (channel, updated_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, seq)`,
  `CREATE INDEX IF NOT EXISTS messages_unanswered ON messages (unanswered) WHERE unanswered`,
  `CREATE INDEX IF NOT EXISTS leads_created ON leads (created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS tickets_updated ON tickets (updated_at DESC, ticket_number DESC)`,
  `CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status_category, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS tickets_assignee ON tickets (assignee_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages (ticket_number, seq)`,
  `CREATE INDEX IF NOT EXISTS sources_status ON sources (status, updated_at DESC)`,

  // Full-text over what someone actually searches a ticket by. Generated and
  // indexed rather than computed per query, because searchTickets runs on
  // every keystroke in the help desk.
  `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS search tsvector
     GENERATED ALWAYS AS (
       setweight(to_tsvector('simple', coalesce(subject, '')), 'A') ||
       setweight(to_tsvector('simple', coalesce(description, '')), 'B')
     ) STORED`,
  `CREATE INDEX IF NOT EXISTS tickets_search ON tickets USING GIN (search)`,
  `CREATE INDEX IF NOT EXISTS ticket_messages_search ON ticket_messages
     USING GIN (to_tsvector('simple', coalesce(body, '')))`,
]
