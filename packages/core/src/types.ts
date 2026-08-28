/**
 * The shared vocabulary of the whole engine. Every module below talks in these
 * shapes and nothing else, which is what makes the parts swappable: replace the
 * crawler, the chunker or the store and the rest of the pipeline never notices.
 */

/** A page, file or blob of text before it has been split up. */
export interface Document {
  /** Stable identity. A URL for web pages, a path for files. */
  id: string
  title: string
  text: string
  /** Where a human should be sent to read this. Shown as the citation link. */
  url?: string
  /** Anything you want to filter or display on later. */
  meta?: Record<string, string | number | boolean>
}

/** A retrievable slice of a Document. */
export interface Chunk {
  id: string
  docId: string
  title: string
  /** Heading trail such as `Billing > Refunds`, used to keep context in-prompt. */
  section?: string
  text: string
  url?: string
  meta?: Record<string, string | number | boolean>
}

/** A chunk plus why the retriever picked it. */
export interface Match {
  chunk: Chunk
  score: number
  /** Which retrievers voted for it. Useful when debugging bad answers. */
  from: Array<'keyword' | 'vector'>
}

/** Anything that can produce documents. Implement this to add a data source. */
export interface Source {
  name: string
  load(ctx: SourceContext): Promise<Document[]>
}

export interface SourceContext {
  /** Called as pages arrive so the CLI can render progress. */
  onProgress?: (event: ProgressEvent) => void
  signal?: AbortSignal
}

export interface ProgressEvent {
  phase: 'discover' | 'fetch' | 'chunk' | 'embed' | 'write'
  message: string
  done?: number
  total?: number
}

/** Splits documents into chunks. Implement this to change chunking strategy. */
export interface Chunker {
  name: string
  split(doc: Document): Chunk[]
}

/**
 * Embeddings are optional. Without them the engine runs keyword-only, which
 * needs no credentials at all and still answers well on a normal site.
 */
export interface Embedder {
  name: string
  /** Vector width. Kept small on purpose so the index stays a small file. */
  dimensions: number
  embed(texts: string[], ctx?: SourceContext): Promise<Float32Array[]>
}

/** The serialised, ready-to-query knowledge base. This is what ships to prod. */
export interface KnowledgeIndex {
  version: 1
  createdAt: string
  chunks: Chunk[]
  keyword: KeywordIndex
  vectors?: VectorIndex
  stats: IndexStats
}

export interface IndexStats {
  documents: number
  chunks: number
  characters: number
  /** Present only when the index was built with embeddings. */
  embedded?: number
}

/** Precomputed BM25 postings. Built once at ingest, queried in microseconds. */
export interface KeywordIndex {
  /** term -> flat pairs of [chunkOrdinal, termFrequency]. */
  postings: Record<string, number[]>
  /** Token count per chunk, by ordinal. */
  lengths: number[]
  avgLength: number
  k1: number
  b: number
}

/** Int8-quantised unit vectors, base64 packed. ~1 byte per dimension. */
export interface VectorIndex {
  dimensions: number
  /** base64 of an Int8Array, chunks concatenated in ordinal order. */
  data: string
  model: string
}

export interface RetrieveOptions {
  /** How many chunks to hand the model. */
  topK?: number
  /** Drop matches below this fused score. */
  minScore?: number
  signal?: AbortSignal
}

export interface Retriever {
  name: string
  retrieve(query: string, options?: RetrieveOptions): Promise<Match[]>
}

/** One turn of conversation. */
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

/** What the chat endpoint streams back, one JSON object per SSE frame. */
export type StreamFrame =
  | { type: 'sources'; sources: SourceRef[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason?: string }
  | { type: 'error'; message: string }

export interface SourceRef {
  title: string
  url?: string
  section?: string
}
