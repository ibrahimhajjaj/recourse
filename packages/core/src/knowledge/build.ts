import type {
  Chunk,
  Chunker,
  Document,
  Embedder,
  KnowledgeIndex,
  ProgressEvent,
  Source,
  SourceContext,
} from '../types.js'
import { markdownChunker } from '../chunk/index.js'
import { buildKeywordIndex } from './bm25.js'
import { packVectors, quantize, unpackVectors } from './vector.js'
import { parseIndex } from './serialize.js'
import type { VectorStore } from '../retrieve/vector-store.js'

export interface BuildOptions {
  /** One or many places to read content from. */
  sources: Source[]
  /** Defaults to the heading-aware markdown chunker. */
  chunker?: Chunker
  /** Omit to build a keyword-only index, which needs no credentials. */
  embedder?: Embedder
  onProgress?: (event: ProgressEvent) => void
  signal?: AbortSignal
  /**
   * Writes the vectors to a database instead of into the index file.
   *
   * The file carries its vectors inline by default, which is right until the
   * file is the problem: it is parsed on every cold start and the vectors are
   * most of its weight. Point this at a store and the index keeps only the
   * keyword half.
   *
   * Written here rather than after the fact because this is where the vectors
   * are still full-precision floats. The file format packs them to int8, and
   * moving them out afterwards would quantise a second time for nothing.
   */
  vectorStore?: VectorStore
  /**
   * The index this build replaces. Text that has not changed is not embedded
   * again.
   *
   * Most re-crawls change almost nothing: a site of four hundred pages ships
   * one edit, and paying to embed the other three hundred and ninety-nine is
   * the largest avoidable cost in the whole pipeline. A chunk is carried over
   * when its indexed text is byte-for-byte what it was, which is a stricter
   * test than "same page": an edited paragraph re-embeds, and so does one
   * whose heading moved, because the heading is part of what was embedded.
   *
   * Ignored when the embedding model has changed. Vectors from two models are
   * not comparable, and half an index from each would rank nonsense highly
   * while looking like it worked.
   */
  previous?: KnowledgeIndex | string
}

/**
 * The whole ingest pipeline in one place: load, chunk, index, optionally embed.
 * Every stage is an interface, so swapping the crawler for a database reader or
 * the chunker for a sentence splitter is a one-line change at the call site.
 */
/**
 * The previous index's chunks, grouped by the document they came from.
 *
 * The index stores chunks rather than documents, so this is the only way back
 * to "everything that page produced last time". It is also what decides which
 * pages may be asked about conditionally at all: a page whose chunks are gone
 * has to be read again.
 */
function chunkedByDocument(before: KnowledgeIndex | undefined): Map<string, Chunk[]> {
  const byDocument = new Map<string, Chunk[]>()
  if (!before) return byDocument

  for (const chunk of before.chunks) {
    const list = byDocument.get(chunk.docId)
    if (list) list.push(chunk)
    else byDocument.set(chunk.docId, [chunk])
  }

  return byDocument
}

export async function buildIndex(options: BuildOptions): Promise<KnowledgeIndex> {
  const report = options.onProgress ?? (() => {})
  const chunker = options.chunker ?? markdownChunker()

  const before = typeof options.previous === 'string' ? parseIndex(options.previous) : options.previous
  // Only for pages the previous index can still produce chunks for. A source
  // told a page is unchanged does not fetch it, so if there is nothing to carry
  // over the page would vanish from the index entirely.
  const carryable = chunkedByDocument(before)
  const validators = { ...before?.fetched }
  const unchanged = new Set<string>()

  const ctx: SourceContext = {
    onProgress: report,
    signal: options.signal,
    validatorFor: (id) => (carryable.has(id) ? before?.fetched?.[id] : undefined),
    report: (id, outcome) => {
      if (outcome.unchanged && carryable.has(id)) unchanged.add(id)
      if (outcome.validator) validators[id] = outcome.validator
      else if (!outcome.unchanged) delete validators[id]
    },
  }

  const documents: Document[] = []
  for (const source of options.sources) {
    documents.push(...(await source.load(ctx)))
  }

  // Two sources can legitimately return the same page; last one wins.
  const unique = [...new Map(documents.map((doc) => [doc.id, doc])).values()]

  // A page reported unchanged and also returned was read after all, so the
  // fresh copy wins and nothing is carried over for it.
  for (const doc of unique) unchanged.delete(doc.id)

  report({ phase: 'chunk', message: `splitting ${unique.length} documents` })
  const rechunked = unique.flatMap((doc) => chunker.split(doc))
  const kept = [...unchanged].flatMap((id) => carryable.get(id) ?? [])

  if (kept.length > 0) {
    report({
      phase: 'chunk',
      message: `${unchanged.size} pages were unchanged and keep their ${kept.length} chunks`,
    })
  }

  const chunks = [...rechunked, ...kept]

  if (chunks.length === 0) {
    throw new Error('nothing to index: every source came back empty')
  }

  // Heading trail goes into the indexed text so a query matching only the
  // heading ("refund policy") still finds the paragraph underneath it.
  const searchable = chunks.map((chunk) =>
    [chunk.title, chunk.section, chunk.text].filter(Boolean).join('\n'),
  )

  report({ phase: 'chunk', message: `built ${chunks.length} chunks` })
  const keyword = buildKeywordIndex(searchable)

  let vectors: KnowledgeIndex['vectors']
  let embedded: number | undefined

  if (options.embedder) {
    const carried = await carryOver(
      before,
      options.embedder.name,
      searchable,
      chunks,
      options.vectorStore !== undefined,
    )
    // Positions that still need a vector, in order.
    const fresh = searchable.map((_text, position) => position).filter((position) => !carried.rows.has(position))

    if (carried.rows.size > 0) {
      report({
        phase: 'embed',
        message: `${carried.rows.size} of ${chunks.length} chunks are unchanged and keep their vectors`,
      })
    }

    report({ phase: 'embed', message: `embedding ${fresh.length} chunks`, done: 0, total: fresh.length })
    const values =
      fresh.length > 0
        ? await options.embedder.embed(
            fresh.map((position) => searchable[position] as string),
            ctx,
          )
        : []
    embedded = values.length

    if (options.vectorStore) {
      // The store already holds the carried-over rows under the same chunk
      // ids, so only the fresh ones are written.
      const written = fresh.map((position, offset) => ({
        chunk: chunks[position] as Chunk,
        vector: values[offset] as Float32Array,
      }))
      await writeVectors(options.vectorStore, written, report)
    } else {
      const rows: Int8Array[] = new Array(chunks.length)
      for (const [position, row] of carried.rows) rows[position] = row
      fresh.forEach((position, offset) => {
        rows[position] = quantize(values[offset] as Float32Array)
      })

      const width = values[0]?.length ?? carried.dimensions

      // A provider that changed the width of a model's output without changing
      // its name. Packing short rows against long ones would misalign every
      // vector after the first and produce an index that loads, scores, and is
      // wrong, so the carried rows are replaced rather than trusted. Only they
      // need redoing; the fresh ones are already the new width.
      if (carried.rows.size > 0 && values.length > 0 && width !== carried.dimensions) {
        report({
          phase: 'embed',
          message: `previous vectors are ${carried.dimensions} wide, this model returns ${width}; re-embedding the ${carried.rows.size} carried over`,
        })

        const stale = [...carried.rows.keys()]
        const replaced = await options.embedder.embed(stale.map((position) => searchable[position] as string), ctx)
        stale.forEach((position, offset) => {
          rows[position] = quantize(replaced[offset] as Float32Array)
        })
        embedded += replaced.length
      }

      vectors = packVectors(rows, width, options.embedder.name)
    }
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    chunks,
    keyword,
    vectors,
    stats: {
      // Counted including the pages nobody read this time. A build that says it
      // indexed nine documents when the site has four hundred reads as a broken
      // crawl, which is exactly the wrong alarm to raise.
      documents: unique.length + unchanged.size,
      chunks: chunks.length,
      characters:
        unique.reduce((sum, doc) => sum + doc.text.length, 0) +
        kept.reduce((sum, chunk) => sum + chunk.text.length, 0),
      embedded,
    },
    ...(Object.keys(validators).length > 0 ? { fetched: validators } : {}),
  }
}

/**
 * Puts the vectors in a store, in batches.
 *
 * A single statement carrying fifty thousand vectors is one most databases
 * refuse and every one of them dislikes, so this is chunked. Failure
 * propagates: a build that silently produced an index with no vectors in
 * either place would answer every question badly and look fine.
 */
async function writeVectors(
  store: VectorStore,
  written: Array<{ chunk: Chunk; vector: Float32Array }>,
  report: (event: ProgressEvent) => void,
): Promise<void> {
  const BATCH = 500

  for (let start = 0; start < written.length; start += BATCH) {
    const entries = written.slice(start, start + BATCH).map(({ chunk, vector }) => ({
      id: chunk.id,
      chunk,
      vector,
    }))

    await store.upsert(entries)
    report({
      phase: 'embed',
      message: `wrote ${Math.min(start + BATCH, written.length)} of ${written.length} vectors to ${store.name}`,
      done: Math.min(start + BATCH, written.length),
      total: written.length,
    })
  }
}

/**
 * Which of the new chunks can keep a vector the previous index already paid
 * for, and the row to use for each.
 *
 * Matching is on the exact indexed text rather than on the chunk id or the
 * document url. Ids are derived from position, so inserting a paragraph high
 * up a page renumbers everything below it while changing none of the words:
 * matching on id would re-embed the whole page, and matching on text carries
 * all of it over. The reverse case matters more: an id that stays the same
 * while the words change must never keep the old vector, or the index would
 * quietly answer from text nobody can read any more.
 */
async function carryOver(
  previous: KnowledgeIndex | string | undefined,
  model: string,
  searchable: string[],
  chunks: Chunk[],
  /**
   * Whether the chunk id has to match as well.
   *
   * It does when the vectors live in a database, because there the row is
   * found by id and carrying one over means not writing it: a chunk whose text
   * survived but whose id moved would be skipped and then have no vector at
   * all. In the file the rows are copied by hand into the new order, so the id
   * is irrelevant and matching on text alone carries over strictly more.
   */
  keyed: boolean,
): Promise<{ rows: Map<number, Int8Array>; dimensions: number }> {
  const empty = { rows: new Map<number, Int8Array>(), dimensions: 0 }
  if (!previous) return empty

  const before = typeof previous === 'string' ? parseIndex(previous) : previous
  const old = before.vectors

  // No vectors to carry, or vectors from a different model, which are not
  // comparable with the ones about to be produced.
  if (!old || old.model !== model || old.dimensions === 0) return empty
  if (before.chunks.length === 0) return empty

  const rows = unpackVectors(old)
  // A vector blob that does not line up with the chunk list cannot be indexed
  // into safely, and guessing which end is short would misalign every row.
  if (rows.length !== before.chunks.length) return empty

  // The separator is written as an escape rather than as the byte itself.
  // A literal NUL in a source file makes grep treat the whole file as binary
  // and skip it in silence, so every search of this codebase returned nothing
  // from here and looked like the pattern was wrong.
  const key = async (text: string, id: string) =>
    keyed ? `${id}\u0000${await digest(text)}` : digest(text)

  const known = new Map<string, number>()
  await Promise.all(
    before.chunks.map(async (chunk, position) => {
      const text = [chunk.title, chunk.section, chunk.text].filter(Boolean).join('\n')
      const at = await key(text, chunk.id)
      // First occurrence wins. Two identical chunks share a vector anyway, so
      // which one is carried over makes no difference to any score.
      if (!known.has(at)) known.set(at, position)
    }),
  )

  const carried = new Map<number, Int8Array>()
  await Promise.all(
    searchable.map(async (text, position) => {
      const at = await key(text, (chunks[position] as Chunk).id)
      const found = known.get(at)
      if (found === undefined) return
      const row = rows[found]
      if (row) carried.set(position, row)
    }),
  )

  return { rows: carried, dimensions: old.dimensions }
}

/**
 * SHA-256, hex, through the platform's own crypto.
 *
 * `crypto.subtle` rather than node:crypto because this package runs on
 * Workers as well, and a cryptographic digest rather than a cheap one because
 * a collision here silently answers from a vector belonging to different text.
 */
const encoder = new TextEncoder()

async function digest(value: string): Promise<string> {
  const hashed = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(hashed)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
