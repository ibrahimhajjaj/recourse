/**
 * What pgvector costs at a size the index file cannot carry.
 *
 * The card asks for 50,000 chunks. The vectors are synthesised rather than
 * embedded, deliberately: this measures the store, and embedding fifty
 * thousand chunks would measure a local model's throughput instead and take an
 * afternoon.
 *
 *   TEST_DATABASE_URL=postgres://... npx tsx src/bench-vectors.mts [chunks]
 */

import { Pool } from 'pg'
import { pgVectorStore, migrateVectors } from '@helpdeck/store-postgres'

const url = process.env.TEST_DATABASE_URL
if (!url) {
  console.log('skipped: set TEST_DATABASE_URL to a postgres with pgvector')
  process.exit(0)
}

const total = Number(process.argv[2] ?? 50_000)
const DIMENSIONS = 768
const pool = new Pool({ connectionString: url })
const table = `bench_vectors_${Date.now().toString(36)}`

/** A unit vector, deterministic per ordinal so a run is reproducible. */
function vectorFor(seed: number): Float32Array {
  const out = new Float32Array(DIMENSIONS)
  let state = seed * 2654435761
  let sum = 0

  for (let d = 0; d < DIMENSIONS; d++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    const value = state / 0x7fffffff - 0.5
    out[d] = value
    sum += value * value
  }

  const length = Math.sqrt(sum) || 1
  for (let d = 0; d < DIMENSIONS; d++) out[d] = (out[d] as number) / length

  return out
}

const seconds = (from: number) => ((Date.now() - from) / 1000).toFixed(1)

try {
  await migrateVectors(pool, table, DIMENSIONS)
  const store = pgVectorStore({ pool, table, dimensions: DIMENSIONS })

  console.log(`writing ${total.toLocaleString()} vectors of ${DIMENSIONS} dimensions`)
  const writing = Date.now()
  const BATCH = 500

  for (let start = 0; start < total; start += BATCH) {
    const entries = []
    for (let n = start; n < Math.min(start + BATCH, total); n++) {
      entries.push({
        id: `chunk-${n}`,
        chunk: {
          id: `chunk-${n}`,
          docId: `doc-${Math.floor(n / 20)}`,
          title: `Document ${Math.floor(n / 20)}`,
          text: `passage ${n}`,
        },
        vector: vectorFor(n),
      })
    }
    await store.upsert(entries)
    if (start % 10_000 === 0 && start > 0) console.log(`  ${start.toLocaleString()} in ${seconds(writing)}s`)
  }

  console.log(`written in ${seconds(writing)}s`)

  const { rows } = await pool.query(`SELECT pg_size_pretty(pg_total_relation_size($1)) AS size`, [table])
  console.log(`table size: ${rows[0].size}`)

  // Cold, then warm. The first query on an HNSW index pays for reading it in.
  const query = vectorFor(42)
  const timings: number[] = []

  for (let run = 0; run < 12; run++) {
    const started = performance.now()
    const hits = await store.search(query, 6, { minScore: 0 })
    const took = performance.now() - started
    timings.push(took)
    if (run === 0) console.log(`first query: ${took.toFixed(0)}ms, top hit ${hits[0]?.id} at ${hits[0]?.score.toFixed(4)}`)
  }

  const warm = timings.slice(2).sort((a, b) => a - b)
  const p50 = warm[Math.floor(warm.length / 2)] as number
  const p95 = warm[Math.floor(warm.length * 0.95)] ?? warm[warm.length - 1]

  console.log(`warm query p50: ${p50.toFixed(0)}ms, p95: ${(p95 as number).toFixed(0)}ms, over ${warm.length} runs`)
} finally {
  await pool.query(`DROP TABLE IF EXISTS ${table}`)
  await pool.end()
}
