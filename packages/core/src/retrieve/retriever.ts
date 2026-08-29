import type { Embedder, KnowledgeIndex, Match, RetrieveOptions, Retriever } from '../types.js'
import { queryTermCount, searchKeyword } from '../knowledge/bm25.js'
import { indexVectorStore, type VectorStore } from './vector-store.js'
import { fuse, type RankedList } from './fuse.js'

export interface RetrieverOptions {
  index: KnowledgeIndex
  /** Enables the vector half of the hybrid. Must match the ingest-time embedder. */
  embedder?: Embedder
  topK?: number
  /**
   * Stops one long page from filling the entire context window with near
   * duplicates of the same passage.
   */
  maxPerDocument?: number
  /**
   * Keyword hits scoring below this fraction of the best hit are dropped before
   * fusion. BM25 will happily return a chunk that shares one incidental word
   * with the question, and passing that to the model costs tokens, latency and
   * precision for nothing.
   */
  keywordFloor?: number
  /** Vector hits below this cosine are dropped. Unrelated text lands near zero. */
  vectorFloor?: number
  /**
   * From this many distinct query terms onward, a chunk must contain at least
   * two of them. Below it, one is allowed, because a two-word question has no
   * room to spare.
   */
  coverageFrom?: number
  /**
   * Where the vectors live.
   *
   * Defaults to the ones inside the index file, which is right until the file
   * itself becomes the problem. Point this at a database and the index keeps
   * only the keyword half, which is the smaller half by some margin.
   */
  vectorStore?: VectorStore
}

const DEFAULT_TOP_K = 6
const DEFAULT_MAX_PER_DOCUMENT = 3
/** Over-fetch before fusing: fusion can only reorder what it was given. */
const CANDIDATE_MULTIPLIER = 4
const DEFAULT_KEYWORD_FLOOR = 0.35
/**
 * The cosine a passage must reach to count as relevant at all.
 *
 * Measured rather than guessed. Against nomic-embed-text on a support corpus,
 * questions the corpus can answer score 0.63 and up, while questions it cannot
 * ("do you sell bicycles?", "what is the weather in Cairo?") top out at 0.49.
 * Embedding models do not return low numbers for unrelated text the way people
 * expect; nothing scored below 0.39 even when the subject was completely
 * different, so a floor down at 0.25 admitted everything.
 *
 * That matters beyond retrieval quality: passages in the prompt are what the
 * model answers from, so an off-topic question that retrieves three irrelevant
 * pages is a question the agent will try to answer instead of declining.
 *
 * The scale is model-dependent. If you swap the embedder, measure your own
 * separation and set `vectorFloor` rather than trusting this number.
 *
 * Know what this does and does not do. It is an off-topic detector, not a
 * relevance classifier. Independent measurement of the same signal across five
 * BEIR benchmarks (arXiv 2604.15484) reports F1 = 0.996 separating queries
 * from a different subject entirely, falling to F1 = 0.472 separating relevant
 * from irrelevant questions inside the same subject. Our own numbers were
 * measured on cross-subject questions, which is the easy half. Expect this to
 * catch "what is the weather" and not to catch a question about the wrong
 * product line.
 */
const DEFAULT_VECTOR_FLOOR = 0.5
/**
 * Tuned on real support content: at four terms or more, a single shared word
 * is reliably a coincidence, while at three it is still often the answer.
 */
const DEFAULT_COVERAGE_FROM = 4

/**
 * Keyword and vector search, fused. Keyword alone nails exact terms: product
 * names, error codes and SKUs, which is most of what support questions contain.
 * Vectors alone catch paraphrase. Running both and fusing the rankings gets
 * each one's strength without having to pick.
 *
 * With no embedder, or an index built without vectors, this degrades to plain
 * BM25 and keeps working. That is the zero-credential path.
 */
export function createRetriever(options: RetrieverOptions): Retriever {
  const { index } = options
  const topK = options.topK ?? DEFAULT_TOP_K
  const maxPerDocument = options.maxPerDocument ?? DEFAULT_MAX_PER_DOCUMENT
  const keywordFloor = options.keywordFloor ?? DEFAULT_KEYWORD_FLOOR
  const vectorFloor = options.vectorFloor ?? DEFAULT_VECTOR_FLOOR
  const coverageFrom = options.coverageFrom ?? DEFAULT_COVERAGE_FROM
  // Either a store was given, or the index brought its own. Both answer the
  // same question, so everything below this line is identical for both.
  const vectorStore = options.vectorStore ?? indexVectorStore(index)
  const canUseVectors = Boolean(vectorStore && options.embedder)

  if (vectorStore && index.vectors && vectorStore.dimensions !== index.vectors.dimensions) {
    // A query vector from one model against stored vectors from another gives
    // distances that mean nothing, and the answers degrade in a way that looks
    // like a bad model rather than a misconfiguration.
    throw new Error(
      `the vector store holds ${vectorStore.dimensions}-dimension vectors but the index was built with ` +
        `${index.vectors.dimensions}. They have to come from the same embedding model.`,
    )
  }

  // Fusion works in ids so the two halves can be compared, and a store knows
  // nothing about positions in this file. Built once rather than per query.
  const idOf = (ord: number): string => index.chunks[ord]?.id ?? String(ord)
  const byId = new Map(index.chunks.map((chunk) => [chunk.id, chunk]))

  return {
    name: canUseVectors ? 'hybrid' : 'keyword',

    async retrieve(query: string, retrieveOptions: RetrieveOptions = {}): Promise<Match[]> {
      const limit = retrieveOptions.topK ?? topK
      const candidates = limit * CANDIDATE_MULTIPLIER
      const lists: RankedList<string>[] = []

      const keyword = searchKeyword(index.keyword, query, candidates)
      // Relative, because BM25 scores mean nothing in absolute terms: they
      // depend on corpus size and term rarity, so only the gap to the best hit
      // in this same query is comparable.
      const keywordBest = keyword[0]?.score ?? 0
      const required = queryTermCount(query) >= coverageFrom ? 2 : 1
      lists.push({
        label: 'keyword',
        ids: keyword
          .filter(
            (hit) =>
              (hit.matched >= required || hit.score >= keywordBest * 0.9) &&
              hit.score >= keywordBest * keywordFloor,
          )
          .map((hit) => idOf(hit.ord)),
      })

      if (canUseVectors && vectorStore && options.embedder) {
        try {
          const [vector] = await options.embedder.embed([query], { signal: retrieveOptions.signal })
          if (vector) {
            // The floor is absolute, because cosine is already normalised and
            // comparable. Pushed into the store so a database can apply it in
            // SQL rather than shipping rows back to be discarded.
            const hits = await vectorStore.search(vector, candidates, {
              minScore: vectorFloor,
              ...(retrieveOptions.signal ? { signal: retrieveOptions.signal } : {}),
            })
            lists.push({ label: 'vector', ids: hits.map((hit) => hit.id) })
          }
        } catch {
          // An embedding or database outage should degrade the answer, not
          // break the chat: the keyword half still works.
        }
      }

      const fused = fuse(lists)
      const perDocument = new Map<string, number>()
      const matches: Match[] = []

      for (const result of fused) {
        // A store may know about a chunk this index does not, if the two were
        // built from different content. Skipping is the only safe reading:
        // there is no text to put in the prompt.
        const chunk = byId.get(result.id)
        if (!chunk) continue
        if (retrieveOptions.minScore != null && result.score < retrieveOptions.minScore) continue

        const used = perDocument.get(chunk.docId) ?? 0
        if (used >= maxPerDocument) continue
        perDocument.set(chunk.docId, used + 1)

        matches.push({ chunk, score: result.score, from: result.from })
        if (matches.length >= limit) break
      }

      return matches
    },
  }
}
