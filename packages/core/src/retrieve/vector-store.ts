/**
 * Where the vectors live.
 *
 * The default is the index file itself: int8 vectors scanned exhaustively,
 * which is honest and fast to roughly twenty thousand chunks. Past that it is
 * not the scan that hurts but the file, cold-start parse time and function
 * memory become the ceiling first, and a JSON index you can commit to git
 * stops being one you want to.
 *
 * This is the seam where that changes without anything else moving. Fusion
 * already works in ids rather than positions, so a store that answers "the
 * nearest chunk ids to this vector" is a drop-in replacement for the scan.
 */

import type { Chunk, KnowledgeIndex } from '../types.js'
import { searchVector } from '../knowledge/vector.js'

export interface VectorHit {
  /** The `Chunk.id` this vector belongs to. */
  id: string
  /** Cosine similarity, where 1 is identical. */
  score: number
}

export interface VectorSearchOptions {
  /** Hits below this are not worth returning. */
  minScore?: number
  signal?: AbortSignal
}

export interface VectorStore {
  /** Shown in the retriever's name, so a log says which path answered. */
  name: string
  /**
   * Vector width.
   *
   * A query vector has to come from the same model as the stored ones or the
   * distances are meaningless, and a width mismatch is the loudest symptom of
   * that mistake. Checked at construction rather than discovered as bad
   * answers weeks later.
   */
  dimensions: number
  /** Nearest first. Implementations may return fewer than `limit`. */
  search(vector: Float32Array, limit: number, options?: VectorSearchOptions): Promise<VectorHit[]>
  /**
   * Writes vectors. Called by ingest, once per batch of chunks.
   *
   * Upsert rather than insert because re-ingesting a source that has not
   * changed should be idempotent, not a duplicate.
   */
  upsert(entries: Array<{ id: string; chunk: Chunk; vector: Float32Array }>): Promise<void>
}

/**
 * The vectors that ship inside the index file.
 *
 * Read-only: this one is written by `ingest`, not by `upsert`, because the
 * whole point of it is that the index is a file you build and deploy rather
 * than a service you write to at runtime.
 */
export function indexVectorStore(index: KnowledgeIndex): VectorStore | null {
  const vectors = index.vectors
  if (!vectors) return null

  return {
    name: 'index',
    dimensions: vectors.dimensions,

    async search(vector, limit, options = {}) {
      const floor = options.minScore ?? 0
      return searchVector(vectors, vector, limit)
        .filter((hit) => hit.score >= floor)
        .map((hit) => ({ id: index.chunks[hit.ord]?.id ?? String(hit.ord), score: hit.score }))
    },

    async upsert() {
      throw new Error(
        'the index vector store is built by `helpdeck ingest` and cannot be written to at runtime. ' +
          'Configure a vectorStore if you need that.',
      )
    },
  }
}
