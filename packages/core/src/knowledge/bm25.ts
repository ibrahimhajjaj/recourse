import type { KeywordIndex } from '../types.js'
import { tokenize } from './tokenize.js'

/** Okapi BM25 defaults. Decades of retrieval papers land on roughly these. */
const K1 = 1.2
const B = 0.75

/**
 * Builds the postings table. Terms map to a flat `[ordinal, frequency, ...]`
 * array rather than an array of pairs: half the JSON, and scanning a flat
 * number array avoids allocating an object per posting at query time.
 */
export function buildKeywordIndex(texts: string[]): KeywordIndex {
  const postings: Record<string, number[]> = Object.create(null)
  const lengths: number[] = new Array(texts.length)
  let total = 0

  for (let ord = 0; ord < texts.length; ord++) {
    const tokens = tokenize(texts[ord] ?? '')
    lengths[ord] = tokens.length
    total += tokens.length

    const counts = new Map<string, number>()
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)

    for (const [term, frequency] of counts) {
      const list = postings[term] ?? (postings[term] = [])
      list.push(ord, frequency)
    }
  }

  return {
    postings,
    lengths,
    avgLength: texts.length > 0 ? total / texts.length : 0,
    k1: K1,
    b: B,
  }
}

export interface KeywordHit {
  ord: number
  score: number
  /** Distinct query terms this chunk actually contains. */
  matched: number
}

/** How many distinct terms the query contributed, for the caller's coverage rule. */
export function queryTermCount(query: string): number {
  return new Set(tokenize(query)).size
}

/**
 * Scores every chunk that shares at least one term with the query. Cost is
 * proportional to the postings of the query terms, not to the corpus, so a
 * 10,000-chunk index answers as fast as a 100-chunk one.
 */
export function searchKeyword(index: KeywordIndex, query: string, limit: number): KeywordHit[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []

  const documentCount = index.lengths.length
  if (documentCount === 0) return []

  const scores = new Map<number, number>()
  const matched = new Map<number, number>()
  const seen = new Set<string>()

  for (const term of terms) {
    // A term repeated in the query should not count twice.
    if (seen.has(term)) continue
    seen.add(term)

    const list = index.postings[term]
    if (!list) continue

    const containing = list.length / 2
    // Probabilistic IDF, +1 smoothed so a term in every chunk scores ~0, never negative.
    const idf = Math.log(1 + (documentCount - containing + 0.5) / (containing + 0.5))

    for (let i = 0; i < list.length; i += 2) {
      const ord = list[i] as number
      const frequency = list[i + 1] as number
      const length = index.lengths[ord] ?? 0
      const norm = 1 - index.b + (index.b * length) / (index.avgLength || 1)
      const contribution = (idf * (frequency * (index.k1 + 1))) / (frequency + index.k1 * norm)
      scores.set(ord, (scores.get(ord) ?? 0) + contribution)
      matched.set(ord, (matched.get(ord) ?? 0) + 1)
    }
  }

  // Ranking only. Deciding which of these are good enough to send to a model
  // is a retrieval policy, and it lives in the retriever so it can be tuned
  // without touching the index.
  return [...scores.entries()]
    .map(([ord, score]) => ({ ord, score, matched: matched.get(ord) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
