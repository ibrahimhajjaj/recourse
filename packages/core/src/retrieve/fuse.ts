/**
 * Reciprocal rank fusion. Keyword scores are unbounded BM25 sums and vector
 * scores are cosines in [-1, 1]; adding them directly means whichever retriever
 * happens to have the bigger numbers wins every time. RRF throws the magnitudes
 * away and keeps only the ordering, which is the part both retrievers agree is
 * meaningful.
 *
 * Cormack et al. (2009) found the constant matters little above ~20; 60 is the
 * value from the paper and the one every implementation since has copied.
 */
const K = 60

export interface RankedList<T extends string | number> {
  label: 'keyword' | 'vector'
  ids: T[]
}

export interface FusedResult<T extends string | number> {
  id: T
  score: number
  from: Array<'keyword' | 'vector'>
}

export function fuse<T extends string | number>(lists: RankedList<T>[]): FusedResult<T>[] {
  const scores = new Map<T, number>()
  const sources = new Map<T, Set<'keyword' | 'vector'>>()

  for (const list of lists) {
    for (let rank = 0; rank < list.ids.length; rank++) {
      const id = list.ids[rank] as T
      scores.set(id, (scores.get(id) ?? 0) + 1 / (K + rank + 1))
      const set = sources.get(id) ?? new Set()
      set.add(list.label)
      sources.set(id, set)
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score, from: [...(sources.get(id) ?? [])] }))
    .sort((a, b) => b.score - a.score)
}
