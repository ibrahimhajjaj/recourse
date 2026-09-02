import { describe, expect, it } from 'vitest'
import { DEFAULT_PARSERS } from '../src/sources/documents.js'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('the formats a business keeps things in that are not documents', () => {
  it('reads a spreadsheet export into a table the chunker can split', async () => {
    const parse = DEFAULT_PARSERS['.csv']
    expect(parse).toBeDefined()

    const markdown = await parse!(bytes('name,price\nWidget,9.99\nGadget,14.50\n'))

    // A price list is worth nothing to retrieval unless the value stays next to
    // the thing it is the price of.
    expect(markdown).toContain('Widget')
    expect(markdown).toContain('9.99')
    expect(markdown.indexOf('Widget')).toBeLessThan(markdown.indexOf('Gadget'))
  })

  it('registers a reader for every format the converter handles', () => {
    for (const extension of [
      '.pptx', '.ppt', '.xlsx', '.ods', '.odp', '.odt', '.doc', '.rtf', '.epub', '.csv',
    ]) {
      expect(DEFAULT_PARSERS[extension], extension).toBeTypeOf('function')
    }
  })

  it('leaves PDF and Word on the readers that need no compiled binary', async () => {
    // Both must keep working where a platform-specific download cannot be
    // installed, so neither may be quietly rerouted through the converter.
    const { parsePdf, parseDocx } = await import('../src/sources/documents.js')

    expect(DEFAULT_PARSERS['.pdf']).toBe(parsePdf)
    expect(DEFAULT_PARSERS['.docx']).toBe(parseDocx)
  })

  it('says which package is missing rather than throwing a module error', async () => {
    const { loadParser } = await import('../src/sources/documents.js')

    await expect(loadParser('@firecrawl/not-a-real-parser', 'npm install it')).rejects.toThrow(
      /needs the optional .* package/,
    )
  })
})
