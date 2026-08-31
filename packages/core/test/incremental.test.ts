import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/knowledge/build.js'
import { serializeIndex } from '../src/knowledge/serialize.js'
import { unpackVectors } from '../src/knowledge/vector.js'
import { textSource } from '../src/sources/text.js'
import type { Document, Embedder } from '../src/types.js'

/**
 * An embedder that counts what it was asked to embed, and gives every distinct
 * string its own direction so a carried-over vector can be told apart from a
 * freshly computed one.
 */
function counting(name = 'test-embedder', dimensions = 8): Embedder & { seen: string[] } {
  const seen: string[] = []

  return {
    name,
    seen,
    async embed(values: string[]) {
      seen.push(...values)
      return values.map((value) => {
        const vector = new Float32Array(dimensions)
        for (let position = 0; position < value.length; position++) {
          vector[position % dimensions] = (vector[position % dimensions] as number) + value.charCodeAt(position)
        }
        return vector
      })
    },
  }
}

function pages(refunds: string, shipping = 'Orders ship within two business days.'): Document[] {
  return [
    { id: 'refunds', title: 'Refunds', text: `# Refunds\n\n${refunds}` },
    { id: 'shipping', title: 'Shipping', text: `# Shipping\n\n${shipping}` },
  ]
}

describe('re-indexing a corpus that has barely changed', () => {
  it('embeds everything on the first run', async () => {
    const embedder = counting()
    const index = await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))], embedder })

    expect(embedder.seen).toHaveLength(index.chunks.length)
    expect(index.stats.embedded).toBe(index.chunks.length)
  })

  it('embeds only what changed on the second', async () => {
    const first = counting()
    const before = await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))], embedder: first })

    const second = counting()
    const after = await buildIndex({
      sources: [textSource(pages('Refunds take 45 days.'))],
      embedder: second,
      previous: before,
    })

    expect(second.seen).toHaveLength(1)
    expect(second.seen[0]).toContain('45 days')
    expect(after.stats.embedded).toBe(1)
    expect(after.chunks).toHaveLength(before.chunks.length)
  })

  it('embeds nothing at all when nothing changed', async () => {
    const first = counting()
    const before = await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))], embedder: first })

    const second = counting()
    const after = await buildIndex({
      sources: [textSource(pages('Refunds take 30 days.'))],
      embedder: second,
      previous: before,
    })

    expect(second.seen).toHaveLength(0)
    expect(unpackVectors(after.vectors!)).toEqual(unpackVectors(before.vectors!))
  })

  it('carries the right vector to the right row', async () => {
    const first = counting()
    const before = await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))], embedder: first })

    // A new page in front of the others, so every carried chunk moves down a
    // row. Getting this wrong misaligns the whole index while it still looks
    // like a valid one.
    const grown: Document[] = [
      { id: 'about', title: 'About', text: '# About\n\nWe sell things.' },
      ...pages('Refunds take 30 days.'),
    ]

    const second = counting()
    const after = await buildIndex({ sources: [textSource(grown)], embedder: second, previous: before })

    expect(second.seen).toHaveLength(1)

    const oldRows = unpackVectors(before.vectors!)
    const newRows = unpackVectors(after.vectors!)

    for (const [position, chunk] of before.chunks.entries()) {
      const moved = after.chunks.findIndex((candidate) => candidate.text === chunk.text)
      expect(newRows[moved]).toEqual(oldRows[position])
    }
  })

  it('re-embeds a chunk whose id stayed the same but whose words changed', async () => {
    const first = counting()
    const before = await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))], embedder: first })

    const second = counting()
    const after = await buildIndex({
      sources: [textSource(pages('Refunds are never given.'))],
      embedder: second,
      previous: before,
    })

    const changed = after.chunks.findIndex((chunk) => chunk.text.includes('never given'))
    const wasThere = before.chunks.findIndex((chunk) => chunk.text.includes('30 days'))

    // Same position, same id, and it must not have kept the old vector.
    expect(after.chunks[changed]?.id).toBe(before.chunks[wasThere]?.id)
    expect(unpackVectors(after.vectors!)[changed]).not.toEqual(unpackVectors(before.vectors!)[wasThere])
  })

  it('ignores an index built by a different embedding model', async () => {
    const before = await buildIndex({
      sources: [textSource(pages('Refunds take 30 days.'))],
      embedder: counting('old-model'),
    })

    const second = counting('new-model')
    await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))], embedder: second, previous: before })

    // Every chunk again: vectors from two models cannot share an index.
    expect(second.seen).toHaveLength(before.chunks.length)
  })

  it('ignores a keyword-only index', async () => {
    const before = await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))] })
    expect(before.vectors).toBeUndefined()

    const second = counting()
    await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))], embedder: second, previous: before })
    expect(second.seen.length).toBeGreaterThan(0)
  })

  it('reads a previous index that arrives serialised', async () => {
    const before = await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))], embedder: counting() })

    const second = counting()
    await buildIndex({
      sources: [textSource(pages('Refunds take 30 days.'))],
      embedder: second,
      previous: serializeIndex(before),
    })

    expect(second.seen).toHaveLength(0)
  })

  it('replaces carried rows when the model quietly changed its width', async () => {
    const before = await buildIndex({
      sources: [textSource(pages('Refunds take 30 days.'))],
      embedder: counting('same-name', 8),
    })

    // Same model name, different output width. Packing 8-wide rows against
    // 16-wide ones would misalign every vector after the first and produce an
    // index that loads, scores, and is wrong.
    const wider = counting('same-name', 16)
    const after = await buildIndex({
      sources: [textSource(pages('Refunds take 45 days.'))],
      embedder: wider,
      previous: before,
    })

    expect(after.vectors?.dimensions).toBe(16)
    expect(wider.seen).toHaveLength(after.chunks.length)

    // Every row is the full new width, so nothing is misaligned.
    const rows = unpackVectors(after.vectors!)
    expect(rows).toHaveLength(after.chunks.length)
    for (const row of rows) expect(row).toHaveLength(16)
  })

  it('falls back to embedding everything when the previous vectors do not line up', async () => {
    const before = await buildIndex({ sources: [textSource(pages('Refunds take 30 days.'))], embedder: counting() })

    // A file edited by hand, or written by an older version. Carrying rows over
    // by position here would pair text with somebody else's vector.
    const damaged = { ...before, chunks: before.chunks.slice(0, 1) }

    const second = counting()
    const after = await buildIndex({
      sources: [textSource(pages('Refunds take 30 days.'))],
      embedder: second,
      previous: damaged,
    })

    expect(second.seen).toHaveLength(after.chunks.length)
  })
})
