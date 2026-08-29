import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { createRetriever } from '../src/retrieve/retriever.js'
import { indexVectorStore, type VectorStore } from '../src/retrieve/vector-store.js'
import type { Document, Embedder, KnowledgeIndex } from '../src/types.js'

/**
 * The point of this seam is that vectors can live somewhere other than the
 * index file without anything else changing. These tests exist to prove that
 * claim rather than to restate it.
 */

const documents: Document[] = [
  { id: 'shipping', title: 'Shipping', text: '# Shipping\n\nDelivery to Ireland takes about a week.' },
  { id: 'returns', title: 'Returns', text: '# Returns\n\nUnopened bags can be returned within 30 days.' },
  { id: 'coffee', title: 'Coffee', text: '# Coffee\n\nThe house blend is chocolate and hazelnut.' },
]

/** Deterministic vectors, so the tests assert on wiring rather than on a model. */
function fakeEmbedder(dimensions = 8): Embedder {
  return {
    name: 'fake',
    dimensions,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(dimensions)
        for (let index = 0; index < text.length; index++) {
          vector[index % dimensions] = (vector[index % dimensions] as number) + text.charCodeAt(index)
        }
        return vector
      })
    },
  }
}

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({ sources: [textSource(documents)], embedder: fakeEmbedder() })
  return cached
}

describe('the vectors inside the index file', () => {
  it('is itself a vector store', async () => {
    const store = indexVectorStore(await index())

    expect(store?.name).toBe('index')
    expect(store?.dimensions).toBe(8)
  })

  it('answers with chunk ids rather than positions', async () => {
    const built = await index()
    const store = indexVectorStore(built)
    const [vector] = await fakeEmbedder().embed(['returns'])

    const hits = await (store as VectorStore).search(vector as Float32Array, 3)

    expect(hits.length).toBeGreaterThan(0)
    // Every id has to resolve, or fusion silently drops results.
    for (const hit of hits) {
      expect(built.chunks.some((chunk) => chunk.id === hit.id)).toBe(true)
    }
  })

  it('refuses to be written to, since ingest builds it', async () => {
    const store = indexVectorStore(await index()) as VectorStore
    await expect(store.upsert([])).rejects.toThrow(/helpdeck ingest/)
  })

  it('is absent when the index has no vectors', async () => {
    const keywordOnly = await buildIndex({ sources: [textSource(documents)] })
    expect(indexVectorStore(keywordOnly)).toBeNull()
  })
})

describe('a vector store of your own', () => {
  /** Records what it was asked, so the wiring can be asserted. */
  function spyStore(built: KnowledgeIndex): VectorStore & { calls: number[] } {
    const calls: number[] = []
    return {
      calls,
      name: 'spy',
      dimensions: 8,
      async search(_vector, limit) {
        calls.push(limit)
        // Always the returns chunk, whatever was asked.
        const chunk = built.chunks.find((candidate) => candidate.docId === 'returns')
        return chunk ? [{ id: chunk.id, score: 0.99 }] : []
      },
      async upsert() {},
    }
  }

  it('is used instead of the index vectors', async () => {
    const built = await index()
    const store = spyStore(built)

    const retriever = createRetriever({ index: built, embedder: fakeEmbedder(), vectorStore: store })
    const matches = await retriever.retrieve('anything at all')

    expect(store.calls.length).toBe(1)
    expect(matches.some((match) => match.chunk.docId === 'returns')).toBe(true)
    expect(matches.some((match) => match.from.includes('vector'))).toBe(true)
  })

  it('is over-fetched from, so fusion has something to reorder', async () => {
    const built = await index()
    const store = spyStore(built)

    await createRetriever({ index: built, embedder: fakeEmbedder(), vectorStore: store, topK: 3 }).retrieve('x')

    // Fusion can only reorder what it was given, so the store is asked for
    // more than the caller wants.
    expect(store.calls[0]).toBeGreaterThan(3)
  })

  it('has the relevance floor pushed into it', async () => {
    const built = await index()
    let sawFloor: number | undefined

    const store: VectorStore = {
      name: 'floor-spy',
      dimensions: 8,
      async search(_vector, _limit, options) {
        sawFloor = options?.minScore
        return []
      },
      async upsert() {},
    }

    await createRetriever({
      index: built,
      embedder: fakeEmbedder(),
      vectorStore: store,
      vectorFloor: 0.72,
    }).retrieve('anything')

    // A database should filter in SQL rather than ship rows back to be thrown
    // away here.
    expect(sawFloor).toBe(0.72)
  })

  it('refuses a store whose vectors are a different width', async () => {
    const built = await index()
    const wrong: VectorStore = {
      name: 'wrong-width',
      dimensions: 384,
      async search() { return [] },
      async upsert() {},
    }

    // A query vector from one model against stored vectors from another gives
    // distances that mean nothing, and it looks like a bad model rather than a
    // misconfiguration.
    expect(() => createRetriever({ index: built, embedder: fakeEmbedder(), vectorStore: wrong })).toThrow(
      /same embedding model/,
    )
  })

  it('falls back to keyword when the store is down', async () => {
    const built = await index()
    const broken: VectorStore = {
      name: 'broken',
      dimensions: 8,
      async search() {
        throw new Error('the database is on fire')
      },
      async upsert() {},
    }

    const retriever = createRetriever({ index: built, embedder: fakeEmbedder(), vectorStore: broken })
    const matches = await retriever.retrieve('returned within 30 days')

    // Degraded, not broken: a vector outage must not take the chat down.
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((match) => match.from.includes('keyword'))).toBe(true)
  })

  it('ignores an id the index does not know', async () => {
    const built = await index()
    const stale: VectorStore = {
      name: 'stale',
      dimensions: 8,
      async search() {
        return [{ id: 'a-chunk-from-some-other-corpus', score: 0.99 }]
      },
      async upsert() {},
    }

    const matches = await createRetriever({
      index: built,
      embedder: fakeEmbedder(),
      vectorStore: stale,
    }).retrieve('returned within 30 days')

    // There is no text to put in the prompt for it, so it cannot be a match.
    expect(matches.every((match) => match.chunk.id !== 'a-chunk-from-some-other-corpus')).toBe(true)
  })
})

describe('building straight into a store', () => {
  it('writes the vectors there and leaves them out of the index', async () => {
    const written: Array<{ id: string; vector: Float32Array }> = []
    const store = {
      name: 'fake',
      dimensions: 3,
      async search() {
        return []
      },
      async upsert(entries: Array<{ id: string; chunk: unknown; vector: Float32Array }>) {
        for (const entry of entries) written.push({ id: entry.id, vector: entry.vector })
      },
    }

    const index = await buildIndex({
      sources: [textSource([{ id: 'a', title: 'A', text: '# A\n\nSomething to embed.' }])],
      embedder: {
        name: 'fake',
        dimensions: 3,
        embed: async (texts: string[]) => texts.map(() => Float32Array.from([0.1, 0.2, 0.3])),
      },
      vectorStore: store,
    })

    // The whole point: the file no longer carries them.
    expect(index.vectors).toBeUndefined()
    expect(written).toHaveLength(index.chunks.length)
    expect(index.keyword.lengths.length).toBe(index.chunks.length)

    // Full precision, not the int8 the file format would have packed them to.
    expect(written[0]?.vector[0]).toBeCloseTo(0.1, 6)
  })

  it('keeps the vectors in the file when no store is given', async () => {
    const index = await buildIndex({
      sources: [textSource([{ id: 'a', title: 'A', text: '# A\n\nSomething to embed.' }])],
      embedder: {
        name: 'fake',
        dimensions: 3,
        embed: async (texts: string[]) => texts.map(() => Float32Array.from([0.1, 0.2, 0.3])),
      },
    })

    expect(index.vectors).toBeDefined()
  })

  it('lets a store failure fail the build rather than shipping an index with no vectors', async () => {
    const store = {
      name: 'broken',
      dimensions: 3,
      async search() {
        return []
      },
      async upsert() {
        throw new Error('the database refused')
      },
    }

    // An index with no vectors in either place answers every question badly and
    // looks fine, which is the worst way for this to fail.
    await expect(
      buildIndex({
        sources: [textSource([{ id: 'a', title: 'A', text: '# A\n\nText.' }])],
        embedder: {
          name: 'fake',
          dimensions: 3,
          embed: async (texts: string[]) => texts.map(() => Float32Array.from([0.1, 0.2, 0.3])),
        },
        vectorStore: store,
      }),
    ).rejects.toThrow('the database refused')
  })
})
