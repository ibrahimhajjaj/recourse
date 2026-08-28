import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKnowledgeBase } from '../src/knowledge/base.js'
import { validateSource } from '../src/knowledge/records.js'
import { createRetriever } from '../src/retrieve/retriever.js'
import { fileStore, memoryStore } from '../src/store/index.js'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('validating a source before it is stored', () => {
  it('needs a name and a type', () => {
    expect(() => validateSource({ type: 'text', name: '  ', content: 'x' })).toThrow(/needs a name/)
    expect(() => validateSource({ name: 'x', content: 'y' })).toThrow(/needs a type/)
  })

  it('needs content that could actually be retrieved', () => {
    expect(() => validateSource({ type: 'text', name: 'A', content: '' })).toThrow(/needs content/)
    expect(() => validateSource({ type: 'qna', name: 'A', pairs: [] })).toThrow(/at least one pair/)
    expect(() => validateSource({ type: 'link', name: 'A' })).toThrow(/needs a url/)
  })

  it('refuses a url that would make the server read its own disk', () => {
    expect(() => validateSource({ type: 'link', name: 'A', url: 'file:///etc/passwd' })).toThrow(
      /must be http or https/,
    )
    expect(() => validateSource({ type: 'link', name: 'A', url: 'not a url' })).toThrow(/not a valid url/)
  })
})

describe('managing sources at runtime', () => {
  function base() {
    return createKnowledgeBase({ store: memoryStore() })
  }

  it('adds a source and marks the index stale', async () => {
    const kb = base()
    expect(kb.needsRetrain()).toBe(false)

    await kb.addSource({ type: 'text', name: 'Refunds', content: 'We refund within 30 days of delivery.' })
    expect(kb.needsRetrain()).toBe(true)
  })

  it('builds an index that answers from what was added', async () => {
    const kb = base()
    await kb.addSource({
      type: 'text',
      name: 'Refunds',
      content: '# Refunds\n\nWe refund any order within 30 days of delivery.',
    })

    const index = await kb.train()
    const matches = await createRetriever({ index }).retrieve('refund window')

    expect(matches[0]?.chunk.title).toBe('Refunds')
    expect(kb.needsRetrain()).toBe(false)
  })

  it('indexes question and answer pairs with their alternative phrasings', async () => {
    const kb = base()
    await kb.addSource({
      type: 'qna',
      name: 'FAQ',
      pairs: [
        {
          question: 'How do I cancel?',
          answer: 'From the account page under Subscriptions.',
          alternatives: ['stop being charged'],
        },
      ],
    })

    const index = await kb.train()
    const matches = await createRetriever({ index }).retrieve('how do I stop being charged')
    expect(matches[0]?.chunk.text).toContain('account page')
  })

  it('drops a deleted source from the next build but keeps the record', async () => {
    const kb = base()
    const keep = await kb.addSource({ type: 'text', name: 'Refunds', content: 'We refund within 30 days.' })
    const drop = await kb.addSource({ type: 'text', name: 'Secret', content: 'Internal pricing notes here.' })

    await kb.train()
    await kb.deleteSource(drop.id)
    const index = await kb.train()

    expect(index.chunks.some((chunk) => chunk.title === 'Secret')).toBe(false)
    expect(index.chunks.some((chunk) => chunk.title === 'Refunds')).toBe(true)
    // Soft deleted: still recoverable.
    expect((await kb.getSource(drop.id))?.status).toBe('pending_deletion')
    expect(keep.status).toBe('active')
  })

  it('brings a deleted source back', async () => {
    const kb = base()
    const source = await kb.addSource({ type: 'text', name: 'Refunds', content: 'We refund within 30 days.' })

    await kb.deleteSource(source.id)
    await kb.restoreSource(source.id)
    const index = await kb.train()

    expect(index.chunks.some((chunk) => chunk.title === 'Refunds')).toBe(true)
  })

  it('refuses to change a link url in place', async () => {
    const kb = base()
    const source = await kb.addSource({ type: 'link', name: 'Help', url: 'https://shop.example/help' })
    await expect(kb.updateSource(source.id, { url: 'https://shop.example/other' })).rejects.toThrow(
      /cannot be changed/,
    )
  })

  it('refuses to build with nothing active, rather than serving an empty index', async () => {
    const kb = base()
    const source = await kb.addSource({ type: 'text', name: 'Only', content: 'Some content that is long enough.' })
    await kb.deleteSource(source.id)
    await expect(kb.train()).rejects.toThrow(/no active sources/)
  })

  it('keeps serving the previous index when a rebuild fails', async () => {
    const kb = base()
    const source = await kb.addSource({ type: 'text', name: 'Refunds', content: 'We refund within 30 days.' })

    const good = await kb.train()
    await kb.deleteSource(source.id)
    await expect(kb.train()).rejects.toThrow()

    // Still the working index, not null and not empty.
    expect(kb.index()).toBe(good)
  })

  it('reports what each source contributes', async () => {
    const kb = base()
    await kb.addSource({ type: 'text', name: 'Refunds', content: '# Refunds\n\nWe refund within 30 days.' })
    await kb.addSource({ type: 'qna', name: 'FAQ', pairs: [{ question: 'Q?', answer: 'A long enough answer.' }] })

    await kb.train()
    const summary = await kb.summary()

    expect(summary.total.count).toBe(2)
    expect(summary.byType.text.count).toBe(1)
    expect(summary.byType.qna.count).toBe(1)
    expect(summary.total.chunks).toBeGreaterThan(0)
    expect(summary.needsRetrain).toBe(false)
    expect(summary.lastTrainedAt).toBeTruthy()
  })

  it('carries on when one link source is unreachable', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      throw new Error('DNS failure')
    }) as unknown as typeof fetch

    const messages: string[] = []
    try {
      const kb = createKnowledgeBase({
        store: memoryStore(),
        onProgress: (event) => void messages.push(event.message),
      })
      await kb.addSource({ type: 'link', name: 'Dead', url: 'https://gone.example/help' })
      await kb.addSource({ type: 'text', name: 'Refunds', content: '# Refunds\n\nWe refund within 30 days.' })

      const index = await kb.train()
      expect(index.chunks.some((chunk) => chunk.title === 'Refunds')).toBe(true)
      expect(messages.some((message) => message.includes('skipped Dead'))).toBe(true)
    } finally {
      globalThis.fetch = original
    }
  })

  it('purges only what was marked for deletion', async () => {
    const store = memoryStore()
    const kb = createKnowledgeBase({ store })
    const keep = await kb.addSource({ type: 'text', name: 'Keep', content: 'Something worth keeping here.' })
    const drop = await kb.addSource({ type: 'text', name: 'Drop', content: 'Something to remove entirely.' })

    await kb.deleteSource(drop.id)
    expect(await store.purgeSources()).toBe(1)

    expect(await store.getSource(drop.id)).toBeNull()
    expect(await store.getSource(keep.id)).not.toBeNull()
  })
})

describe('sources survive a restart', () => {
  it('reads back the records and their status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helpdeck-kb-'))
    dirs.push(dir)

    const first = createKnowledgeBase({ store: fileStore({ dir }) })
    const keep = await first.addSource({ type: 'text', name: 'Refunds', content: 'We refund within 30 days.' })
    const gone = await first.addSource({ type: 'text', name: 'Old', content: 'Outdated policy text here.' })
    await first.deleteSource(gone.id)

    const second = createKnowledgeBase({ store: fileStore({ dir }) })
    expect((await second.getSource(keep.id))?.name).toBe('Refunds')
    expect((await second.getSource(gone.id))?.status).toBe('pending_deletion')

    const index = await second.train()
    expect(index.chunks.some((chunk) => chunk.title === 'Old')).toBe(false)
  })
})

describe('auto retrain', () => {
  it('rebuilds only when something changed', async () => {
    vi.useFakeTimers()
    try {
      const kb = createKnowledgeBase({ store: memoryStore() })
      await kb.addSource({ type: 'text', name: 'Refunds', content: '# Refunds\n\nWe refund within 30 days.' })
      await kb.train()

      const trained = vi.spyOn(kb, 'train')
      const stop = kb.startAutoRetrain(1000)

      // Nothing changed, so the tick does nothing and costs no credits.
      await vi.advanceTimersByTimeAsync(1100)
      expect(trained).not.toHaveBeenCalled()

      await kb.addSource({ type: 'text', name: 'Shipping', content: 'Orders ship within two business days.' })
      await vi.advanceTimersByTimeAsync(1100)
      expect(trained).toHaveBeenCalled()

      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops when told to', async () => {
    vi.useFakeTimers()
    try {
      const kb = createKnowledgeBase({ store: memoryStore() })
      await kb.addSource({ type: 'text', name: 'A', content: 'Some content long enough to index.' })

      const trained = vi.spyOn(kb, 'train')
      const stop = kb.startAutoRetrain(1000)
      stop()

      await vi.advanceTimersByTimeAsync(3000)
      expect(trained).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
