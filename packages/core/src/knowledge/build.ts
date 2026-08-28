import type {
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

export interface BuildOptions {
  /** One or many places to read content from. */
  sources: Source[]
  /** Defaults to the heading-aware markdown chunker. */
  chunker?: Chunker
  /** Omit to build a keyword-only index, which needs no credentials. */
  embedder?: Embedder
  onProgress?: (event: ProgressEvent) => void
  signal?: AbortSignal
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
    vectors = buildVectorIndex(values, options.embedder.name)
    embedded = values.length
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
