import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { parsePdf } from '../src/sources/documents.js'

/**
 * A one-page PDF with no text operators in it, which is what a scan is once the
 * images are stripped out. Generated rather than downloaded so the test carries
 * no binary nobody can read.
 */
const scanned = () =>
  new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/no-text-layer.pdf', import.meta.url))))

describe('a PDF with no text layer', () => {
  it('says so instead of indexing nothing quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const text = await parsePdf(scanned(), { name: 'scan.pdf' })

      // Nothing to return is the honest answer. The failure this guards against
      // is returning it without a word, which leaves somebody with an empty
      // index and an agent they think is broken.
      expect(text).toBe('')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain('no text at all')
    } finally {
      warn.mockRestore()
    }
  })
})
