import { describe, expect, it } from 'vitest'
import { markdownChunker } from '../src/chunk/markdown.js'
import { parseIndex, serializeIndex } from '../src/knowledge/serialize.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import type { Document } from '../src/types.js'

const chunker = markdownChunker()

function doc(text: string): Document {
  return { id: 'page', title: 'Help', text, url: 'https://example.com/help' }
}

describe('markdown chunker', () => {
  it('carries the full heading trail on every chunk', () => {
    const chunks = chunker.split(doc('# Billing\n\n## Refunds\n\nWe refund within 30 days of delivery.'))
    expect(chunks[0]?.section).toBe('Billing > Refunds')
  })

  it('strips anchor links that documentation generators put inside headings', () => {
    const chunks = chunker.split(
      doc('## [​](https://example.com/help#refunds) Refund policy\n\nWe refund within 30 days.'),
    )
    expect(chunks[0]?.section).toBe('Refund policy')
    expect(chunks[0]?.section).not.toContain('http')
  })

  it('drops navigation blocks but keeps prose that happens to contain a link', () => {
    const chunks = chunker.split(
      doc(
        '# Help\n\n[Home](/)\n[Docs](/docs)\n[Blog](/blog)\n[Careers](/jobs)\n[Legal](/legal)\n\n' +
          'Read the [refund policy](/refunds) before contacting us about a return.',
      ),
    )
    const text = chunks.map((chunk) => chunk.text).join('\n')
    expect(text).toContain('refund policy')
    expect(text).not.toContain('Careers')
  })

  it('resets the trail when a deeper heading is followed by a shallower one', () => {
    const chunks = chunker.split(
      doc('# A\n\n## B\n\ntext about b here\n\n# C\n\ntext about c here'),
    )
    expect(chunks.at(-1)?.section).toBe('C')
  })

  it('does not treat a hash inside a code fence as a heading', () => {
    const chunks = chunker.split(doc('# Setup\n\n```sh\n# install it\nnpm i recourse\n```'))
    expect(chunks.every((chunk) => chunk.section === 'Setup')).toBe(true)
  })

  it('splits long sections and overlaps them so a seam is still findable', () => {
    const paragraph = 'Sentence about shipping and delivery windows. '.repeat(12)
    const chunks = chunker.split(doc(`# Shipping\n\n${[paragraph, paragraph, paragraph].join('\n\n')}`))
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1400)
  })

  it('hard splits a single paragraph that is over budget on its own', () => {
    const chunks = chunker.split(doc(`# Data\n\n${'x'.repeat(5000)}`))
    expect(chunks.length).toBeGreaterThan(2)
  })

  it('folds a stray fragment into its neighbour rather than emitting it alone', () => {
    const chunks = chunker.split(doc('# T\n\nok\n\nA properly long paragraph that clears the minimum size easily.'))
    expect(chunks).toHaveLength(1)
  })

  it('gives every chunk a unique id and keeps the source url', () => {
    const chunks = chunker.split(doc('# A\n\n' + 'long enough body text here. '.repeat(80)))
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length)
    expect(chunks.every((chunk) => chunk.url === 'https://example.com/help')).toBe(true)
  })
})

describe('index build and serialisation', () => {
  const documents: Document[] = [
    { id: 'a', title: 'Refunds', text: '# Refunds\n\nWe refund orders within 30 days of delivery.' },
    { id: 'b', title: 'Shipping', text: '# Shipping\n\nOrders ship within two business days worldwide.' },
  ]

  it('builds a keyword-only index when no embedder is given', async () => {
    const index = await buildIndex({ sources: [textSource(documents)] })
    expect(index.vectors).toBeUndefined()
    expect(index.stats.documents).toBe(2)
    expect(index.stats.chunks).toBeGreaterThan(0)
  })

  it('deduplicates documents that two sources both returned', async () => {
    const index = await buildIndex({ sources: [textSource(documents), textSource(documents)] })
    expect(index.stats.documents).toBe(2)
  })

  it('refuses to build an index from nothing', async () => {
    await expect(buildIndex({ sources: [textSource([])] })).rejects.toThrow(/nothing to index/)
  })

  it('round trips through JSON without losing anything', async () => {
    const index = await buildIndex({ sources: [textSource(documents)] })
    const restored = parseIndex(serializeIndex(index))
    expect(restored.chunks).toEqual(index.chunks)
    expect(restored.keyword.avgLength).toBe(index.keyword.avgLength)
  })

  it('rejects an index written by a future version instead of misreading it', () => {
    expect(() => parseIndex(JSON.stringify({ version: 2, chunks: [], keyword: {} }))).toThrow(/unsupported/)
  })

  it('rejects a malformed index with an actionable message', () => {
    expect(() => parseIndex(JSON.stringify({ version: 1 }))).toThrow(/recourse ingest/)
  })
})
