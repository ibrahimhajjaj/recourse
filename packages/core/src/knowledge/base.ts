import type { Chunker, Document, Embedder, KnowledgeIndex, ProgressEvent } from '../types.js'
import type { Store } from '../store/types.js'
import { buildIndex } from './build.js'
import { newSourceId, validateSource, type SourceRecord, type SourcesSummary, type SourceType } from './records.js'
import { scrape } from '../sources/firecrawl.js'
import { textSource } from '../sources/text.js'
import { getLogger } from '../diagnostics.js'

export interface KnowledgeBaseOptions {
  store: Store
  chunker?: Chunker
  embedder?: Embedder
  /** Raises Firecrawl's limits when refetching link sources. */
  firecrawlApiKey?: string
  /** Called whenever a build finishes, so the serving index can be swapped. */
  onTrained?: (index: KnowledgeIndex) => void | Promise<void>
  onProgress?: (event: ProgressEvent) => void
}

export interface AddSourceInput {
  type: SourceType
  name: string
  content?: string
  url?: string
  pairs?: Array<{ question: string; answer: string; alternatives?: string[] }>
}

/**
 * Knowledge you can edit while the agent is running.
 *
 * Training is a full rebuild rather than an incremental update. Incremental
 * indexing has to keep the BM25 term statistics honest as documents come and
 * go, and getting that subtly wrong degrades every answer quietly. A rebuild
 * of a few thousand chunks takes well under a second, so the simple thing is
 * also the right one until the corpus is very large.
 */
export function createKnowledgeBase(options: KnowledgeBaseOptions) {
  const { store } = options
  let current: KnowledgeIndex | null = null
  let lastTrainedAt: string | undefined
  let dirty = false

  async function addSource(input: AddSourceInput): Promise<SourceRecord> {
    validateSource(input)

    const now = new Date().toISOString()
    const record: SourceRecord = {
      id: newSourceId(input.type),
      type: input.type,
      name: input.name.trim(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      content: input.content,
      url: input.url,
      pairs: input.pairs,
    }

    dirty = true
    return store.createSource(record)
  }

  async function updateSource(id: string, patch: Partial<AddSourceInput>): Promise<SourceRecord | null> {
    const existing = await store.getSource(id)
    if (!existing) return null

    // A link's url is its identity for deduplication and citation; changing it
    // in place would leave chunks pointing at a page that is no longer indexed.
    if (patch.url && patch.url !== existing.url) {
      throw new Error('a link source url cannot be changed; delete it and add the new one')
    }

    validateSource({ ...existing, ...patch })
    dirty = true
    return store.updateSource(id, patch)
  }

  /** Turns a stored record into documents the index builder understands. */
  async function toDocuments(record: SourceRecord): Promise<Document[]> {
    if (record.type === 'qna') {
      return (record.pairs ?? [])
        .filter((pair) => pair.question.trim() && pair.answer.trim())
        .map((pair, position) => ({
          id: `${record.id}:${position}`,
          title: record.name,
          text: `# ${pair.question}\n\n${(pair.alternatives ?? [])
            .map((alternative) => `Also asked as: ${alternative}`)
            .join('\n')}\n\n${pair.answer}`.replace(/\n{3,}/g, '\n\n'),
        }))
    }

    if (record.type === 'link') {
      const page = await scrape(record.url as string, ['markdown'], {
        apiKey: options.firecrawlApiKey,
        attempts: 2,
      })
      if (!page || page.markdown.trim().length < 80) return []

      await store.updateSource(record.id, { fetchedAt: new Date().toISOString() })
      return [{ id: record.id, title: record.name || page.title, text: page.markdown, url: record.url }]
    }

    return [{ id: record.id, title: record.name, text: record.content ?? '' }]
  }

  return {
    addSource,
    updateSource,

    getSource: (id: string) => store.getSource(id),
    listSources: (status?: SourceRecord['status']) => allSources(store, status),

    async deleteSource(id: string) {
      const deleted = await store.deleteSource(id)
      if (deleted) dirty = true
      return deleted
    },

    async restoreSource(id: string) {
      const restored = await store.restoreSource(id)
      if (restored) dirty = true
      return restored
    },

    /**
     * Rebuilds the index from every active source.
     *
     * The previous index keeps serving until this succeeds. A failed rebuild
     * that emptied the knowledge base would turn every answer into "I don't
     * know" without anyone noticing until the complaints arrived.
     */
    async train(): Promise<KnowledgeIndex> {
      const active = await allSources(store, 'active')

      const documents: Document[] = []
      for (const record of active.items) {
        try {
          documents.push(...(await toDocuments(record)))
        } catch (error) {
          // One unreachable page must not abandon the whole rebuild.
          options.onProgress?.({
            phase: 'fetch',
            message: `skipped ${record.name}: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      }

      if (documents.length === 0) throw new Error('no active sources produced any content')

      const index = await buildIndex({
        sources: [textSource(documents)],
        chunker: options.chunker,
        embedder: options.embedder,
        onProgress: options.onProgress,
      })

      // Per-source counts, so the sources list can show what each contributes.
      const perSource = new Map<string, { chunks: number; characters: number }>()
      for (const chunk of index.chunks) {
        const sourceId = chunk.docId.split(':')[0] as string
        const entry = perSource.get(sourceId) ?? { chunks: 0, characters: 0 }
        entry.chunks++
        entry.characters += chunk.text.length
        perSource.set(sourceId, entry)
      }

      for (const record of active.items) {
        const counts = perSource.get(record.id) ?? { chunks: 0, characters: 0 }
        await store.updateSource(record.id, counts)
      }

      current = index
      lastTrainedAt = new Date().toISOString()
      dirty = false

      await options.onTrained?.(index)
      return index
    },

    /** The index currently serving, or null before the first train. */
    index: () => current,

    async summary(): Promise<SourcesSummary> {
      const all = await allSources(store)
      const byType = {
        text: { count: 0, characters: 0 },
        qna: { count: 0, characters: 0 },
        link: { count: 0, characters: 0 },
        file: { count: 0, characters: 0 },
      }

      let chunks = 0
      let characters = 0
      let count = 0

      for (const source of all.items) {
        if (source.status !== 'active') continue
        byType[source.type].count++
        byType[source.type].characters += source.characters ?? 0
        chunks += source.chunks ?? 0
        characters += source.characters ?? 0
        count++
      }

      return { byType, total: { count, characters, chunks }, needsRetrain: dirty, lastTrainedAt }
    },

    /**
     * Retrains on an interval when something has changed.
     *
     * Only when something has changed: link sources cost a Firecrawl credit
     * each, so a nightly rebuild of an unchanged corpus is a bill for nothing.
     * Returns a function that stops the schedule.
     */
    startAutoRetrain(intervalMs: number, options_: { force?: boolean } = {}): () => void {
      const timer = setInterval(() => {
        if (!dirty && !options_.force) return
        void this.train().catch((error: unknown) => {
          getLogger().error('scheduled retrain failed', error)
        })
      }, intervalMs)

      // Never hold a Node process open just to wait for the next rebuild.
      if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      return () => clearInterval(timer)
    },

    /** True when a source changed since the last successful build. */
    needsRetrain: () => dirty,
  }
}

export type KnowledgeBase = ReturnType<typeof createKnowledgeBase>

/**
 * Every source, not the first page of them.
 *
 * A page is capped well below the number a real knowledge base holds, so
 * asking for five hundred and being handed two hundred was the quiet failure
 * this replaces: a rebuild dropped every source past the cap and the agent
 * stopped knowing things, with no error anywhere and nothing to notice until
 * the answers came back wrong.
 *
 * The ceiling is there so a corrupt cursor cannot spin forever, and it is high
 * enough that reaching it means something else is wrong.
 */
async function allSources(
  store: Store,
  status?: SourceRecord['status'],
): Promise<{ items: SourceRecord[] }> {
  const items: SourceRecord[] = []
  let cursor: string | undefined

  for (let page = 0; page < 500; page++) {
    const got = await store.listSources({ ...(status ? { status } : {}), limit: 200, ...(cursor ? { cursor } : {}) })
    items.push(...got.items)
    cursor = got.cursor
    if (!cursor) break
  }

  return { items }
}
