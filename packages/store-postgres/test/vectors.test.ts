import { afterAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { buildIndex, createRetriever, textSource } from 'recourse'
import type { Document, Embedder, KnowledgeIndex } from 'recourse'
import { pgVectorStore, migrateVectors } from '../src/vectors.js'

/**
 * Runs against a real pgvector, and skips cleanly without one.
 *
 * ```
 * docker run -d -p 55432:5432 -e POSTGRES_PASSWORD=recourse -e POSTGRES_DB=recourse \
 *   pgvector/pgvector:pg16
 * TEST_DATABASE_URL=postgres://postgres:recourse@localhost:55432/recourse pnpm test
 * ```
 */
const CONNECTION = process.env.TEST_DATABASE_URL
const pool = CONNECTION ? new pg.Pool({ connectionString: CONNECTION, max: 6 }) : null

const DIMENSIONS = 64

const documents: Document[] = [
  { id: 'shipping', title: 'Shipping', text: '# Shipping\n\nDelivery to Ireland takes about a week.' },
  { id: 'returns', title: 'Returns', text: '# Returns\n\nUnopened bags can be returned within 30 days.' },
  { id: 'coffee', title: 'Coffee', text: '# Coffee\n\nThe house blend is chocolate and hazelnut.' },
  { id: 'account', title: 'Account', text: '# Account\n\nReset your password from the sign in page.' },
]

/**
 * A deterministic stand-in for an embedding model.
 *
 * Character trigrams hashed into buckets. Texts sharing vocabulary land near
 * each other, unrelated ones do not, and the vectors are dense enough to
 * behave like a real embedding.
 *
 * Both of those properties were learned the hard way. Summing character codes
 * by position made every document 0.94 similar to every other, so the test was
 * measuring rounding noise. Hashing whole words into 16 buckets made vectors
 * so sparse that int8 quantisation shifted scores by 0.14 and the two vector
 * paths disagreed, which looked like a bug in the store and was not: measured
 * against dense vectors at realistic widths, the quantisation error is 0.2% at
 * 768 dimensions, because independent per-component errors cancel in a dot
 * product. A fixture has to look like the thing it stands in for.
 */
export function fakeEmbedder(dimensions = DIMENSIONS): Embedder {
  return {
    name: 'fake',
    dimensions,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(dimensions)
        const clean = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')

        for (let start = 0; start + 3 <= clean.length; start++) {
          const trigram = clean.slice(start, start + 3)
          if (trigram.trim().length < 3) continue

          // FNV-1a, for a spread that does not clump the way a character sum
          // does.
          let hash = 2166136261
          for (let index = 0; index < trigram.length; index++) {
            hash ^= trigram.charCodeAt(index)
            hash = Math.imul(hash, 16777619)
          }
          const bucket = Math.abs(hash) % dimensions
          vector[bucket] = (vector[bucket] as number) + 1
        }

        let sum = 0
        for (const value of vector) sum += value * value
        const magnitude = Math.sqrt(sum) || 1
        for (let index = 0; index < dimensions; index++) {
          vector[index] = (vector[index] as number) / magnitude
        }

        return vector
      })
    },
  }
}

let built: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  built ??= await buildIndex({ sources: [textSource(documents)], embedder: fakeEmbedder() })
  return built
}

let created = 0
const pools: pg.Pool[] = []

/** A table of its own per test, so counts and contents are predictable. */
async function freshStore(dimensions = DIMENSIONS) {
  if (!pool) throw new Error('no database')
  const table = `recourse_vec_${process.pid}_${created++}`
  const scoped = new pg.Pool({ connectionString: CONNECTION, max: 4 })
  pools.push(scoped)
  await migrateVectors(scoped, table, dimensions)
  return { store: pgVectorStore({ pool: scoped, dimensions, table, migrate: false }), table, pool: scoped }
}

/** Everything the index knows, written into the store. */
async function fill(store: ReturnType<typeof pgVectorStore>, from: KnowledgeIndex) {
  const embedder = fakeEmbedder()
  const vectors = await embedder.embed(from.chunks.map((chunk) => chunk.text))
  await store.upsert(
    from.chunks.map((chunk, position) => ({ id: chunk.id, chunk, vector: vectors[position] as Float32Array })),
  )
}

afterAll(async () => {
  for (const scoped of pools) await scoped.end().catch(() => {})
  await pool?.end().catch(() => {})
})

describe.skipIf(!CONNECTION)('pgvector', () => {
  it('stores and finds the nearest chunk', async () => {
    const from = await index()
    const { store } = await freshStore()
    await fill(store, from)

    const [query] = await fakeEmbedder().embed(['Unopened bags can be returned within 30 days.'])
    const hits = await store.search(query as Float32Array, 3)

    expect(hits.length).toBeGreaterThan(0)
    // The identical text should come back first and near 1.
    const best = hits[0] as { id: string; score: number }
    expect(from.chunks.find((chunk) => chunk.id === best.id)?.docId).toBe('returns')
    expect(best.score).toBeGreaterThan(0.99)
  })

  it('returns similarity, not distance', async () => {
    // `<=>` gives 0 for identical, which is the opposite convention to the
    // rest of the system. Getting this backwards would rank every result
    // upside down and still look plausible.
    const from = await index()
    const { store } = await freshStore()
    await fill(store, from)

    const [query] = await fakeEmbedder().embed(['Delivery to Ireland takes about a week.'])
    const hits = await store.search(query as Float32Array, 4)

    expect(hits[0]?.score).toBeGreaterThan(hits[hits.length - 1]?.score ?? 1)
    for (const hit of hits) expect(hit.score).toBeLessThanOrEqual(1.0001)
  })

  it('applies the floor in SQL rather than returning rows to discard', async () => {
    const from = await index()
    const { store } = await freshStore()
    await fill(store, from)

    const [query] = await fakeEmbedder().embed(['Unopened bags can be returned within 30 days.'])

    const everything = await store.search(query as Float32Array, 10)
    const filtered = await store.search(query as Float32Array, 10, { minScore: 0.99 })

    expect(filtered.length).toBeLessThan(everything.length)
    for (const hit of filtered) expect(hit.score).toBeGreaterThanOrEqual(0.99)
  })

  it('upserts rather than duplicating', async () => {
    const from = await index()
    const { store, table, pool: scoped } = await freshStore()

    await fill(store, from)
    await fill(store, from)

    const { rows } = await scoped.query<{ count: string }>(`SELECT count(*)::int AS count FROM "${table}"`)
    // Re-ingesting a source that has not changed must be idempotent, not a
    // second copy of every chunk.
    expect(Number(rows[0]?.count)).toBe(from.chunks.length)
  })

  it('refuses a query vector of the wrong width', async () => {
    const { store } = await freshStore()
    await expect(store.search(new Float32Array(8), 3)).rejects.toThrow(/same embedding model/)
  })

  it('does nothing on an empty upsert', async () => {
    const { store } = await freshStore()
    await expect(store.upsert([])).resolves.toBeUndefined()
  })

  it('is safe to migrate from two places at once', async () => {
    if (!pool) return
    const table = `recourse_vec_race_${process.pid}`
    const scoped = new pg.Pool({ connectionString: CONNECTION, max: 4 })
    pools.push(scoped)

    await expect(
      Promise.all([migrateVectors(scoped, table, DIMENSIONS), migrateVectors(scoped, table, DIMENSIONS)]),
    ).resolves.toBeDefined()
  })

  it('survives a table name that is trying to be SQL', async () => {
    if (!pool) return
    // A table name cannot be a bound parameter, so it is quoted. Without
    // doubling the embedded quote this is an injection.
    const hostile = `recourse_vec_"; DROP TABLE recourse_vec_${process.pid}_0; --`
    const scoped = new pg.Pool({ connectionString: CONNECTION, max: 2 })
    pools.push(scoped)

    await expect(migrateVectors(scoped, hostile, DIMENSIONS)).resolves.toBeUndefined()

    const { rows } = await scoped.query<{ count: string }>(
      `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_name = $1`,
      [hostile],
    )
    expect(Number(rows[0]?.count)).toBe(1)
  })
})

describe.skipIf(!CONNECTION)('the retriever with vectors in Postgres', () => {
  it('answers the same as the vectors in the index file', async () => {
    // The claim this whole seam rests on: moving the vectors changes where
    // they live, not what comes back.
    const from = await index()
    const { store } = await freshStore()
    await fill(store, from)

    const embedder = fakeEmbedder()
    const inFile = createRetriever({ index: from, embedder, topK: 3 })
    const inPostgres = createRetriever({ index: from, embedder, topK: 3, vectorStore: store })

    for (const query of ['how long does delivery take', 'can I return a bag', 'what is the house blend']) {
      const a = (await inFile.retrieve(query)).map((match) => match.chunk.docId)
      const b = (await inPostgres.retrieve(query)).map((match) => match.chunk.docId)
      expect(b, query).toEqual(a)
    }
  })

  it('degrades to keyword when the database is unreachable', async () => {
    const from = await index()
    const dead = new pg.Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/nothing', max: 1 })
    pools.push(dead)

    const retriever = createRetriever({
      index: from,
      embedder: fakeEmbedder(),
      vectorStore: pgVectorStore({ pool: dead, dimensions: DIMENSIONS, migrate: false }),
    })

    const matches = await retriever.retrieve('returned within 30 days')

    // A database outage must cost the vector half, not the conversation.
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((match) => match.from.includes('keyword'))).toBe(true)
  })
})
