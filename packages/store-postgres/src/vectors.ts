/**
 * Vectors in Postgres, through pgvector.
 *
 * The index file holds int8 vectors and scans them all, which is honest to
 * roughly twenty thousand chunks. Past that the file is the problem before the
 * scan is: cold-start parse time and function memory. This moves the half that
 * bloats into a database with an index on it, and leaves the keyword half where
 * it was.
 *
 * Needs the extension: `CREATE EXTENSION vector`. Neon, Supabase and RDS all
 * ship it; a plain Postgres needs it installed first.
 */

import { createRequire } from 'node:module'
import type { Pool } from 'pg'
import type { Chunk, VectorHit, VectorSearchOptions, VectorStore } from '@recourse-ai/core'

export interface PgVectorStoreOptions {
  pool?: Pool
  connectionString?: string
  /**
   * Vector width. Must match the embedding model that wrote them, and it is
   * baked into the column type, so changing it means a new table.
   */
  dimensions: number
  /** Defaults to `recourse_vectors`. */
  table?: string
  /** Creates the table and index on first use. */
  migrate?: boolean
  /**
   * How hard HNSW looks at query time. Higher finds more of the true nearest
   * neighbours and costs more; pgvector's default is 40.
   *
   * Worth raising if retrieval quality drops after moving off the exhaustive
   * in-file scan, because that scan is exact and this index is not.
   */
  searchListSize?: number
}

const DEFAULT_TABLE = 'recourse_vectors'

export function pgVectorStore(options: PgVectorStoreOptions): VectorStore {
  const pool = resolvePool(options)
  const table = quoteIdentifier(options.table ?? DEFAULT_TABLE)
  const dimensions = options.dimensions
  const shouldMigrate = options.migrate !== false

  let migrated: Promise<void> | null = null
  async function ready(): Promise<Pool> {
    if (!shouldMigrate) return pool
    migrated ??= migrateVectors(pool, options.table ?? DEFAULT_TABLE, dimensions)
    await migrated
    return pool
  }

  return {
    name: 'pgvector',
    dimensions,

    async search(vector, limit, searchOptions: VectorSearchOptions = {}): Promise<VectorHit[]> {
      if (vector.length !== dimensions) {
        throw new Error(
          `this store holds ${dimensions}-dimension vectors but was given one of ${vector.length}. ` +
            'The query and the stored vectors have to come from the same embedding model.',
        )
      }

      const db = await ready()
      const client = await db.connect()

      try {
        if (options.searchListSize) {
          // Session-scoped, so it does not leak onto whatever uses this
          // connection next.
          await client.query(`SET LOCAL hnsw.ef_search = ${Number(options.searchListSize)}`)
        }

        // `<=>` is cosine *distance*: 0 is identical, 2 is opposite. The rest
        // of the system speaks similarity, so it is subtracted here rather than
        // leaking a second convention into the retriever.
        //
        // The floor is applied in SQL rather than after, so a store holding a
        // million vectors does not ship rows back to be thrown away.
        const minScore = searchOptions.minScore ?? 0
        const result = await client.query<{ id: string; score: string }>(
          `SELECT id, 1 - (embedding <=> $1::vector) AS score
             FROM ${table}
            WHERE 1 - (embedding <=> $1::vector) >= $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3`,
          [toVectorLiteral(vector), minScore, limit],
        )

        return result.rows.map((row) => ({ id: row.id, score: Number(row.score) }))
      } finally {
        client.release()
      }
    },

    async upsert(entries) {
      if (entries.length === 0) return

      const db = await ready()
      const client = await db.connect()

      try {
        await client.query('BEGIN')

        // One statement per batch rather than per row: ingesting fifty thousand
        // chunks one round trip at a time is the difference between a minute
        // and an afternoon.
        for (const batch of chunked(entries, 500)) {
          const values: unknown[] = []
          const rows = batch.map((entry, position) => {
            const at = position * 4
            values.push(entry.id, entry.chunk.docId, toVectorLiteral(entry.vector), entry.chunk.text.slice(0, 200))
            return `($${at + 1}, $${at + 2}, $${at + 3}::vector, $${at + 4})`
          })

          await client.query(
            `INSERT INTO ${table} (id, doc_id, embedding, preview)
             VALUES ${rows.join(', ')}
             ON CONFLICT (id) DO UPDATE SET
               embedding = EXCLUDED.embedding,
               doc_id    = EXCLUDED.doc_id,
               preview   = EXCLUDED.preview`,
            values,
          )
        }

        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  }
}

/** Creates the table and its index. Safe to run from several instances at once. */
export async function migrateVectors(pool: Pool, table: string, dimensions: number): Promise<void> {
  const name = quoteIdentifier(table)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    // Same reasoning as the store's migration: `IF NOT EXISTS` is not atomic
    // against a concurrent session.
    await client.query('SELECT pg_advisory_xact_lock($1)', [8_273_461_903])
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')

    await client.query(
      `CREATE TABLE IF NOT EXISTS ${name} (
         id        TEXT PRIMARY KEY,
         doc_id    TEXT NOT NULL,
         embedding vector(${Number(dimensions)}) NOT NULL,
         -- Enough of the chunk to recognise a row while debugging, without
         -- making this a second home for the text. The index file owns that.
         preview   TEXT
       )`,
    )

    // HNSW rather than IVFFlat: it needs no training pass, so an index built
    // on an empty table stays correct as rows arrive, which is what ingest
    // does. Cosine, because the vectors are unit-normalised.
    await client.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${table}_embedding`)}
         ON ${name} USING hnsw (embedding vector_cosine_ops)`,
    )
    await client.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${table}_doc`)} ON ${name} (doc_id)`)

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * pgvector's text input format.
 *
 * Sent as a string cast to `vector` rather than through a driver type, because
 * that works on every pg version without a plugin.
 */
function toVectorLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(',')}]`
}

/**
 * A table name cannot be a bound parameter, so it is quoted instead.
 *
 * Doubling any embedded quote is what makes an arbitrary string safe as an
 * identifier; without it a table name is a SQL injection with extra steps.
 */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) {
    yield items.slice(start, start + size)
  }
}

function resolvePool(options: PgVectorStoreOptions): Pool {
  if (options.pool) return options.pool
  if (!options.connectionString) {
    throw new Error('pgVectorStore needs a pool or a connectionString')
  }

  const require_ = createRequire(import.meta.url)
  const { Pool: PgPool } = require_('pg') as typeof import('pg')
  return new PgPool({
    connectionString: options.connectionString,
    max: 10,
    idleTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  })
}

export type { Chunk }
