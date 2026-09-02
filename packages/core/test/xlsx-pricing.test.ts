import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARSERS } from '../src/sources/documents.js'
import { buildIndex } from '../src/knowledge/build.js'
import { createRetriever } from '../src/retrieve/retriever.js'
import { textSource } from '../src/sources/text.js'

describe('a price list that arrived as a spreadsheet', () => {
  it('converts into something retrieval can answer from', async () => {
    const data = new Uint8Array(
      readFileSync(fileURLToPath(new URL('./fixtures/prices.xlsx', import.meta.url))),
    )

    const markdown = await DEFAULT_PARSERS['.xlsx']!(data)

    // The row has to survive as a row. A conversion that loses the pairing
    // gives the agent two lists and no way to say which price is which plan.
    expect(markdown).toMatch(/Business.*79 GBP/s)

    const index = await buildIndex({
      sources: [textSource([{ id: 'prices', title: 'Plans and pricing', text: markdown }])],
    })

    const found = await createRetriever({ index }).retrieve('how much is the business plan')

    expect(found.length).toBeGreaterThan(0)
    expect(found[0]?.chunk.text).toContain('79 GBP')
  })
})
