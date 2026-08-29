import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_BYTES,
  decodedSize,
  isImage,
  payloadOf,
  sanitiseName,
  toBytes,
  validateAttachments,
} from '../src/attachments.js'
import { prepareAttachments } from '../src/attachments-prepare.js'

/** A one-page PDF whose text layer is known, so extraction can be checked. */
const PDF =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAxMDEgPj4Kc3RyZWFtCkJUIC9GMSAxNCBUZiA2MCA3MDAgVGQgKEludm9pY2UgTEMtODgyMzEuIFRvdGFsIDQyLjAwIEVVUi4gU3RhdHVzOiBSRUZVTkRFRCBvbiAxNCBBdWd1c3QgMjAyNi4pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzkzIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDYzCiUlRU9GCg=='

/** A data URI of `n` bytes, so size limits can be tested without a real file. */
function fileOf(bytes: number, mimeType = 'image/png'): string {
  return `data:${mimeType};base64,${Buffer.alloc(bytes, 1).toString('base64')}`
}

describe('validateAttachments', () => {
  it('accepts an allowed type under the cap', () => {
    const { accepted, rejected } = validateAttachments([
      { name: 'receipt.png', mimeType: 'image/png', dataUrl: fileOf(1024) },
    ])

    expect(rejected).toEqual([])
    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.bytes).toBe(1024)
  })

  it('refuses a type outside the allowlist', () => {
    const { accepted, rejected } = validateAttachments([
      { name: 'payload.exe', mimeType: 'application/x-msdownload', dataUrl: fileOf(10) },
    ])

    expect(accepted).toEqual([])
    expect(rejected[0]?.reason).toContain('not accepted')
  })

  it('ignores media type parameters when matching the allowlist', () => {
    const { accepted } = validateAttachments([
      { name: 'notes.txt', mimeType: 'text/plain; charset=utf-8', dataUrl: fileOf(20, 'text/plain') },
    ])

    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.mimeType).toBe('text/plain')
  })

  it('refuses a file over the size cap', () => {
    const { accepted, rejected } = validateAttachments(
      [{ name: 'big.png', mimeType: 'image/png', dataUrl: fileOf(5000) }],
      { maxBytes: 4096 },
    )

    expect(accepted).toEqual([])
    expect(rejected[0]?.reason).toContain('4KB')
  })

  it('caps how many files one message may carry', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      name: `shot-${index}.png`,
      mimeType: 'image/png',
      dataUrl: fileOf(10),
    }))

    const { accepted, rejected } = validateAttachments(many, { maxCount: 2 })

    expect(accepted).toHaveLength(2)
    expect(rejected).toHaveLength(4)
    expect(rejected[0]?.reason).toContain('no more than 2')
  })

  it('refuses links unless they are turned on', () => {
    const url = { name: 'invoice.pdf', mimeType: 'application/pdf', url: 'https://example.com/a.pdf' }

    expect(validateAttachments([url]).accepted).toEqual([])
    expect(validateAttachments([url], { allowUrls: true }).accepted).toHaveLength(1)
  })

  it('refuses a link that is not http', () => {
    const { accepted, rejected } = validateAttachments(
      [{ name: 'secret', mimeType: 'text/plain', url: 'file:///etc/passwd' }],
      { allowUrls: true },
    )

    expect(accepted).toEqual([])
    expect(rejected[0]?.reason).toContain('http')
  })

  it('refuses base64 that is not base64', () => {
    const { accepted, rejected } = validateAttachments([
      { name: 'odd.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,<script>alert(1)</script>' },
    ])

    expect(accepted).toEqual([])
    expect(rejected[0]?.reason).toContain('could not be read')
  })

  it('refuses an empty file', () => {
    const { rejected } = validateAttachments([{ name: 'nothing.png', mimeType: 'image/png', dataUrl: '' }])
    expect(rejected[0]?.reason).toContain('empty')
  })

  it('survives junk in place of the array', () => {
    expect(validateAttachments(undefined).accepted).toEqual([])
    expect(validateAttachments('a string').accepted).toEqual([])
    expect(validateAttachments([null, 42, { name: 5 }]).accepted).toEqual([])
  })

  it('defaults to a 10MB cap', () => {
    expect(DEFAULT_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(validateAttachments([{ name: 'a.png', mimeType: 'image/png', dataUrl: fileOf(DEFAULT_MAX_BYTES + 1) }]).accepted).toEqual([])
  })
})

describe('sanitiseName', () => {
  it('strips path separators and traversal', () => {
    expect(sanitiseName('../../etc/passwd')).toBe('._._etc_passwd')
    expect(sanitiseName('C:\\Windows\\system32')).toBe('C:_Windows_system32')
  })

  it('strips control characters', () => {
    expect(sanitiseName('inv\u0000oice\u001b[31m.pdf')).toBe('invoice[31m.pdf')
  })

  it('never returns an empty name', () => {
    expect(sanitiseName('   ')).toBe('file')
    expect(sanitiseName('\u0000')).toBe('file')
  })

  it('caps the length', () => {
    expect(sanitiseName('a'.repeat(500))).toHaveLength(120)
  })
})

describe('decoding helpers', () => {
  it('measures decoded size without decoding', () => {
    expect(decodedSize(Buffer.alloc(300).toString('base64'))).toBe(300)
    expect(decodedSize(Buffer.alloc(301).toString('base64'))).toBe(301)
    expect(decodedSize('')).toBe(0)
  })

  it('takes the payload off a data URI or leaves bare base64 alone', () => {
    expect(payloadOf('data:image/png;base64,AAAA')).toBe('AAAA')
    expect(payloadOf('AAAA')).toBe('AAAA')
  })

  it('round-trips bytes', () => {
    const text = 'hello attachments'
    const dataUrl = `data:text/plain;base64,${Buffer.from(text).toString('base64')}`
    const bytes = toBytes({ name: 'a.txt', mimeType: 'text/plain', dataUrl })

    expect(bytes).not.toBeNull()
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe(text)
  })

  it('knows an image from a document', () => {
    expect(isImage({ name: 'a', mimeType: 'image/webp' })).toBe(true)
    expect(isImage({ name: 'a', mimeType: 'application/pdf' })).toBe(false)
  })
})

describe('prepareAttachments', () => {
  const png = { name: 'damage.png', mimeType: 'image/png', dataUrl: fileOf(64) }

  it('sends an image as a file part', async () => {
    const { parts, context } = await prepareAttachments([png])

    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: 'file', mediaType: 'image/png', filename: 'damage.png' })
    expect(context).toBe('')
  })

  it('describes an image instead of sending it when vision is off', async () => {
    const { parts, context } = await prepareAttachments([png], { vision: false })

    expect(parts).toEqual([])
    expect(context).toContain('damage.png')
    expect(context).toContain('cannot see it')
  })

  it('extracts plain text into the prompt rather than sending bytes', async () => {
    const dataUrl = `data:text/plain;base64,${Buffer.from('Order 1182 was refunded on 3 March.').toString('base64')}`
    const { parts, context } = await prepareAttachments([
      { name: 'order.txt', mimeType: 'text/plain', dataUrl },
    ])

    expect(parts).toEqual([])
    expect(context).toContain('Order 1182 was refunded')
    expect(context).toContain('order.txt')
  })

  it('truncates a very long document', async () => {
    const long = 'x'.repeat(5000)
    const dataUrl = `data:text/plain;base64,${Buffer.from(long).toString('base64')}`
    const { context } = await prepareAttachments(
      [{ name: 'long.txt', mimeType: 'text/plain', dataUrl }],
      { maxTextChars: 100 },
    )

    expect(context).toContain('x'.repeat(100))
    expect(context).not.toContain('x'.repeat(101))
  })

  it('reports a document with no readable text instead of adding an empty block', async () => {
    const dataUrl = `data:text/plain;base64,${Buffer.from('   \n  ').toString('base64')}`
    const { context, failures } = await prepareAttachments([
      { name: 'scan.txt', mimeType: 'text/plain', dataUrl },
    ])

    expect(failures[0]?.reason).toContain('scan')
    // Reported as a failure, not as an empty content block: an unread file is
    // rendered in the prompt as a rule of its own, not as content.
    expect(context).toBe('')
  })

  it('uses a custom extractor for a format it does not know', async () => {
    const dataUrl = `data:application/pdf;base64,${Buffer.from('ignored').toString('base64')}`
    const { context } = await prepareAttachments([{ name: 'inv.pdf', mimeType: 'application/pdf', dataUrl }], {
      extractors: { 'application/pdf': async () => 'Invoice total: 42.00 EUR, paid' },
    })

    expect(context).toContain('Invoice total: 42.00 EUR, paid')
  })

  it('keeps going when one file of several fails', async () => {
    const good = `data:text/plain;base64,${Buffer.from('policy text here').toString('base64')}`
    const { context, failures } = await prepareAttachments(
      [
        { name: 'broken.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' },
        { name: 'good.txt', mimeType: 'text/plain', dataUrl: good },
      ],
      { extractors: { 'application/pdf': async () => { throw new Error('not a PDF') } } },
    )

    expect(context).toContain('policy text here')
    expect(failures).toEqual([{ name: 'broken.pdf', reason: 'not a PDF' }])
    expect(context).not.toContain('broken.pdf')
  })

  /**
   * pdfjs needs a runtime with `process.getBuiltinModule`, so this is skipped
   * rather than failed on older Node. The stub-extractor tests above cover the
   * wiring; this one proves the real parser is reachable through it.
   */
  const canParsePdf = typeof (process as { getBuiltinModule?: unknown }).getBuiltinModule === 'function'

  it.skipIf(!canParsePdf)('reads a real PDF with the built-in parser', async () => {
    const { context, failures, parts } = await prepareAttachments([
      { name: 'invoice.pdf', mimeType: 'application/pdf', dataUrl: `data:application/pdf;base64,${PDF}` },
    ])

    expect(failures).toEqual([])
    expect(parts).toEqual([])
    expect(context).toContain('Invoice LC-88231')
    expect(context).toContain('42.00 EUR')
    expect(context).toContain('REFUNDED')
  })

  it.skipIf(!canParsePdf)('reports a corrupt PDF by what actually went wrong', async () => {
    const { failures } = await prepareAttachments([
      { name: 'broken.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,QUJD' },
    ])

    expect(failures).toHaveLength(1)
    // Not "install pdfjs-dist": the package is right there.
    expect(failures[0]?.reason).not.toContain('Install it with')
    expect(failures[0]?.reason).toContain('PDF')
  })

  it('names a linked document rather than fetching it', async () => {
    const { parts, context } = await prepareAttachments([
      { name: 'terms.pdf', mimeType: 'application/pdf', url: 'https://example.com/terms.pdf' },
    ])

    expect(parts).toEqual([])
    expect(context).toContain('https://example.com/terms.pdf')
  })

  it('passes a hosted image through as a URL part', async () => {
    const { parts } = await prepareAttachments([
      { name: 'shot.png', mimeType: 'image/png', url: 'https://cdn.example.com/shot.png' },
    ])

    expect(parts[0]?.data).toBe('https://cdn.example.com/shot.png')
  })
})
