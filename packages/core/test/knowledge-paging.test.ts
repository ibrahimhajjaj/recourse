import { describe, expect, it } from 'vitest'
import { createKnowledgeBase } from '../src/knowledge/base.js'
import { memoryStore } from '../src/store/index.js'

/**
 * A knowledge base bigger than one page.
 *
 * The quiet failure this covers: a rebuild that read the first page dropped
 * every source past it, so the agent stopped knowing things with no error
 * anywhere and nothing to notice until the answers came back wrong.
 */

async function seeded(count: number) {
  const store = memoryStore()
  const knowledge = createKnowledgeBase({ store })

  for (let index = 0; index < count; index++) {
    await knowledge.addSource({
      type: 'text',
      name: `Page ${index}`,
      content: `Fact number ${index} about the shop.`,
    })
  }

  return { store, knowledge }
}

describe('more sources than fit on a page', () => {
  it('lists every one of them', async () => {
    const { knowledge } = await seeded(250)

    expect((await knowledge.listSources('active')).items).toHaveLength(250)
  })

  it('counts every one of them in the summary', async () => {
    const { knowledge } = await seeded(250)

    expect((await knowledge.summary()).total.count).toBe(250)
  })

  it('indexes every one of them, so the agent does not quietly forget', async () => {
    const { knowledge } = await seeded(250)
    const index = await knowledge.train()

    // The last source is the one a first-page read would have lost.
    const found = await index.chunks.filter((chunk) => chunk.text.includes('Fact number 249'))
    expect(found.length).toBeGreaterThan(0)
  })
})
