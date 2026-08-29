import type {
  Chunk,
  Chunker,
  Document,
  Embedder,
  KnowledgeIndex,
  ProgressEvent,
  Source,
} from '../types.js'
import { markdownChunker } from '../chunk/index.js'
import { buildKeywordIndex } from './bm25.js'
import { buildVectorIndex } from './vector.js'
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
}

/**
 * The whole ingest pipeline in one place: load, chunk, index, optionally embed.
 * Every stage is an interface, so swapping the crawler for a database reader or
 * the chunker for a sentence splitter is a one-line change at the call site.
 */
export async function buildIndex(options: BuildOptions): Promise<KnowledgeIndex> {
  const report = options.onProgress ?? (() => {})
  const chunker = options.chunker ?? markdownChunker()
  const ctx = { onProgress: report, signal: options.signal }

  const documents: Document[] = []
  for (const source of options.sources) {
    documents.push(...(await source.load(ctx)))
  }

  // Two sources can legitimately return the same page; last one wins.
  const unique = [...new Map(documents.map((doc) => [doc.id, doc])).values()]

  report({ phase: 'chunk', message: `splitting ${unique.length} documents` })
  const chunks = unique.flatMap((doc) => chunker.split(doc))

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
    report({ phase: 'embed', message: `embedding ${chunks.length} chunks`, done: 0, total: chunks.length })
    const values = await options.embedder.embed(searchable, ctx)
    embedded = values.length

    if (options.vectorStore) {
      await writeVectors(options.vectorStore, chunks, values, report)
    } else {
      vectors = buildVectorIndex(values, options.embedder.name)
    }
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    chunks,
    keyword,
    vectors,
    stats: {
      documents: unique.length,
      chunks: chunks.length,
      characters: unique.reduce((sum, doc) => sum + doc.text.length, 0),
      embedded,
    },
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
  chunks: Chunk[],
  values: Float32Array[],
  report: (event: ProgressEvent) => void,
): Promise<void> {
  const BATCH = 500

  for (let start = 0; start < chunks.length; start += BATCH) {
    const entries = chunks.slice(start, start + BATCH).map((chunk, offset) => ({
      id: chunk.id,
      chunk,
      vector: values[start + offset] as Float32Array,
    }))

    await store.upsert(entries)
    report({
      phase: 'embed',
      message: `wrote ${Math.min(start + BATCH, chunks.length)} of ${chunks.length} vectors to ${store.name}`,
      done: Math.min(start + BATCH, chunks.length),
      total: chunks.length,
    })
  }
}
