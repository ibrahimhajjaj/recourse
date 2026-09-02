import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARSERS } from '../src/sources/documents.js'

describe('a handbook that arrived as a Word document', () => {
  it('reads it into markdown with the heading still a heading', async () => {
    const data = new Uint8Array(
      readFileSync(fileURLToPath(new URL('./fixtures/handbook.docx', import.meta.url))),
    )

    const markdown = await DEFAULT_PARSERS['.docx']!(data)

    // The heading has to survive as one, because the chunker splits on
    // headings and a handbook read as one flat paragraph is one flat chunk.
    expect(markdown).toMatch(/^#\s*Returns/m)
    expect(markdown).toContain('45 days')
  })
})
