import type { Embedder, KnowledgeIndex, Match, RetrieveOptions, Retriever } from '../types.js'
import { queryTermCount, searchKeyword } from '../knowledge/bm25.js'
import { searchVector } from '../knowledge/vector.js'
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
  const canUseVectors = Boolean(index.vectors && options.embedder)

  return {
    name: canUseVectors ? 'hybrid' : 'keyword',

    async retrieve(query: string, retrieveOptions: RetrieveOptions = {}): Promise<Match[]> {
      const limit = retrieveOptions.topK ?? topK
      const candidates = limit * CANDIDATE_MULTIPLIER
      const lists: RankedList<number>[] = []

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
          .map((hit) => hit.ord),
      })

      if (canUseVectors && index.vectors && options.embedder) {
        try {
          const [vector] = await options.embedder.embed([query], { signal: retrieveOptions.signal })
          if (vector) {
            const hits = searchVector(index.vectors, vector, candidates)
            // Absolute, because cosine is already normalised and comparable.
            lists.push({
              label: 'vector',
              ids: hits.filter((hit) => hit.score >= vectorFloor).map((hit) => hit.ord),
            })
          }
        } catch {
          // An embedding outage should degrade the answer, not break the chat.
        }
      }

      const fused = fuse(lists)
      const perDocument = new Map<string, number>()
      const matches: Match[] = []

      for (const result of fused) {
        const chunk = index.chunks[result.id]
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
