import { describe, expect, it } from 'vitest'
import { memoryBlobs, type Blobs } from '../src/storage/blobs.js'
import { s3Blobs } from '../src/storage/s3.js'
import {
  resolveStoredAttachments,
  signReference,
  toBase64,
  verifyReference,
} from '../src/storage/references.js'
import { downloadRoute, uploadRoute, uploadUrlRoute } from '../src/server/upload.js'
import { validateAttachments } from '../src/attachments.js'

const SECRET = 'a-secret-that-is-long-enough'

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/upload', { method: 'POST', body, headers })
}

describe('upload route', () => {
  it('stores a file and hands back a signed reference', async () => {
    const blobs = memoryBlobs()
    const handle = uploadRoute({ blobs, secret: SECRET })

    const response = await handle(
      post('hello from a file', { 'x-file-type': 'text/plain', 'x-file-name': 'notes.txt' }),
    )
    const body = (await response.json()) as { key: string; token: string; bytes: number }

    expect(response.status).toBe(200)
    expect(body.bytes).toBe(17)
    expect(await verifyReference(SECRET, body.key, body.token)).toBe(true)
    expect((await blobs.head(body.key))?.filename).toBe('notes.txt')
  })

  it('refuses a media type that is not on the list', async () => {
    const handle = uploadRoute({ blobs: memoryBlobs(), secret: SECRET })
    const response = await handle(post('MZ', { 'x-file-type': 'application/x-msdownload' }))

    expect(response.status).toBe(415)
  })

  it('refuses an oversized file before reading the body', async () => {
    const blobs = memoryBlobs()
    let stored = 0
    const counting: Blobs = { ...blobs, put: async (...args) => (stored++, blobs.put(...args)) }

    const handle = uploadRoute({ blobs: counting, secret: SECRET, policy: { maxBytes: 10 } })
    const response = await handle(
      new Request('https://example.test/upload', {
        method: 'POST',
        body: 'x'.repeat(4000),
        headers: { 'x-file-type': 'text/plain', 'content-length': '4000' },
      }),
    )

    expect(response.status).toBe(413)
    expect(stored).toBe(0)
  })

  it('refuses an oversized body that lied about its length', async () => {
    // `content-length` is a claim. A chunked request does not have to make one
    // at all, so the real check has to happen after the read as well.
    const handle = uploadRoute({ blobs: memoryBlobs(), secret: SECRET, policy: { maxBytes: 10 } })
    const response = await handle(post('x'.repeat(4000), { 'x-file-type': 'text/plain' }))

    expect(response.status).toBe(413)
  })

  it('never lets a filename become a path', async () => {
    const blobs = memoryBlobs()
    const handle = uploadRoute({ blobs, secret: SECRET })

    const response = await handle(
      post('x', { 'x-file-type': 'text/plain', 'x-file-name': '../../../etc/passwd' }),
    )
    const body = (await response.json()) as { key: string }

    expect(body.key.startsWith('attachments/')).toBe(true)
    expect(body.key).not.toContain('..')
  })

  it('honours a rate limiter', async () => {
    const handle = uploadRoute({
      blobs: memoryBlobs(),
      secret: SECRET,
      rateLimit: { check: async () => ({ ok: false, remaining: 0, resetAt: 0 }) },
    })

    expect((await handle(post('x', { 'x-file-type': 'text/plain' }))).status).toBe(429)
  })

  it('answers 501 rather than 500 when the backend cannot sign', async () => {
    const handle = uploadUrlRoute({ blobs: memoryBlobs(), secret: SECRET })
    const response = await handle(post('', { 'x-file-type': 'image/png' }))

    expect(response.status).toBe(501)
  })
})

describe('download route', () => {
  it('serves an object to a caller holding its token', async () => {
    const blobs = memoryBlobs()
    await blobs.put('attachments/x.txt', new TextEncoder().encode('the contents'), {
      mimeType: 'text/plain',
      filename: 'x.txt',
    })
    const token = await signReference(SECRET, 'attachments/x.txt')

    const handle = downloadRoute({ blobs, secret: SECRET })
    const response = await handle(
      new Request(`https://example.test/file?key=attachments/x.txt&token=${token}`),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('the contents')
    // Always an attachment: an SVG or an HTML file rendered from your own
    // origin is stored cross-site scripting.
    expect(response.headers.get('Content-Disposition')).toContain('attachment')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('offers a non-ASCII filename in a form a browser can read', async () => {
    const blobs = memoryBlobs()
    await blobs.put('attachments/y.txt', new TextEncoder().encode('x'), {
      mimeType: 'text/plain',
      filename: 'فاتورة.txt',
    })
    const token = await signReference(SECRET, 'attachments/y.txt')

    const response = await downloadRoute({ blobs, secret: SECRET })(
      new Request(`https://example.test/file?key=attachments/y.txt&token=${token}`),
    )
    const header = response.headers.get('Content-Disposition') ?? ''

    // A header value is bytes. The name has to go in encoded, with an ASCII
    // fallback beside it, or the download is saved as mojibake.
    expect(header).toContain("filename*=UTF-8''")
    expect(/filename="[\u0020-\u007e]*"/.test(header)).toBe(true)
  })

  it('answers 404 to a caller who guessed the key', async () => {
    const blobs = memoryBlobs()
    await blobs.put('attachments/x.txt', new TextEncoder().encode('the contents'), {
      mimeType: 'text/plain',
    })

    const handle = downloadRoute({ blobs, secret: SECRET })
    const response = await handle(
      new Request('https://example.test/file?key=attachments/x.txt&token=' + '0'.repeat(64)),
    )

    expect(response.status).toBe(404)
  })
})

describe('stored references', () => {
  it('refuses a key this deployment did not issue', async () => {
    const blobs = memoryBlobs()
    await blobs.put('attachments/someone-elses.pdf', new Uint8Array([1, 2, 3]), {
      mimeType: 'application/pdf',
    })

    const resolved = await resolveStoredAttachments(
      [
        {
          name: 'invoice.pdf',
          mimeType: 'application/pdf',
          key: 'attachments/someone-elses.pdf',
          token: '0'.repeat(64),
        },
      ],
      { blobs, secret: SECRET },
    )

    expect(resolved.accepted).toHaveLength(0)
    expect(resolved.rejected[0]?.reason).toBe('that file is no longer available')
  })

  it('refuses a token signed with a different secret', async () => {
    const blobs = memoryBlobs()
    await blobs.put('attachments/a.pdf', new Uint8Array([1]), { mimeType: 'application/pdf' })

    const resolved = await resolveStoredAttachments(
      [
        {
          name: 'a.pdf',
          mimeType: 'application/pdf',
          key: 'attachments/a.pdf',
          token: await signReference('a different secret', 'attachments/a.pdf'),
        },
      ],
      { blobs, secret: SECRET },
    )

    expect(resolved.accepted).toHaveLength(0)
  })

  it('says the same thing about a stolen key and a missing one', async () => {
    // Two different reasons would turn the endpoint into a way of asking which
    // keys exist.
    const blobs = memoryBlobs()
    const missing = await resolveStoredAttachments(
      [
        {
          name: 'gone.pdf',
          mimeType: 'application/pdf',
          key: 'attachments/gone.pdf',
          token: await signReference(SECRET, 'attachments/gone.pdf'),
        },
      ],
      { blobs, secret: SECRET },
    )
    const stolen = await resolveStoredAttachments(
      [{ name: 'x.pdf', mimeType: 'application/pdf', key: 'attachments/x.pdf', token: '0'.repeat(64) }],
      { blobs, secret: SECRET },
    )

    expect(missing.rejected[0]?.reason).toBe(stolen.rejected[0]?.reason)
  })

  it('loads a document as bytes so its text can be extracted', async () => {
    const blobs = memoryBlobs()
    const key = 'attachments/notes.txt'
    await blobs.put(key, new TextEncoder().encode('the invoice total is 42'), {
      mimeType: 'text/plain',
    })

    const resolved = await resolveStoredAttachments(
      [
        {
          name: 'notes.txt',
          mimeType: 'text/plain',
          key,
          token: await signReference(SECRET, key),
        },
      ],
      { blobs, secret: SECRET },
    )

    expect(resolved.accepted[0]?.dataUrl).toContain('data:text/plain;base64,')
    expect(atob(resolved.accepted[0]?.dataUrl?.split(',')[1] as string)).toBe('the invoice total is 42')
  })

  it('refuses a stored file larger than the turn will carry', async () => {
    const blobs = memoryBlobs()
    const key = 'attachments/huge.pdf'
    await blobs.put(key, new Uint8Array(2048), { mimeType: 'application/pdf' })

    const resolved = await resolveStoredAttachments(
      [
        {
          name: 'huge.pdf',
          mimeType: 'application/pdf',
          key,
          token: await signReference(SECRET, key),
        },
      ],
      { blobs, secret: SECRET, maxBytes: 1024 },
    )

    expect(resolved.accepted).toHaveLength(0)
    expect(resolved.rejected[0]?.reason).toContain('under')
  })

  it('leaves inline attachments in the same message alone', async () => {
    const resolved = await resolveStoredAttachments(
      [{ name: 'shot.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }],
      { blobs: memoryBlobs(), secret: SECRET },
    )

    expect(resolved.accepted).toHaveLength(1)
    expect(resolved.accepted[0]?.dataUrl).toBe('data:image/png;base64,AAAA')
  })

  it('refuses stored references outright when nothing can resolve them', () => {
    const { accepted, rejected } = validateAttachments([
      { name: 'a.pdf', mimeType: 'application/pdf', key: 'attachments/a.pdf', token: '0'.repeat(64) },
    ])

    expect(accepted).toHaveLength(0)
    expect(rejected[0]?.reason).toBe('uploaded files are not accepted here')
  })

  it('refuses a token that is not the right shape before hashing anything', () => {
    const { accepted } = validateAttachments(
      [{ name: 'a.pdf', mimeType: 'application/pdf', key: 'attachments/a.pdf', token: 'nope' }],
      { allowStored: true },
    )

    expect(accepted).toHaveLength(0)
  })

  it('encodes a large file without blowing the stack', () => {
    // `String.fromCharCode(...bytes)` on this many arguments throws, and the
    // only place that shows up is somebody uploading a real photograph.
    const big = new Uint8Array(3 * 1024 * 1024).fill(65)
    expect(toBase64(big).length).toBe(4 * 1024 * 1024)
  })
})

const MINIO = 'http://127.0.0.1:59000'
const minioUp = await fetch(`${MINIO}/minio/health/live`, { signal: AbortSignal.timeout(1500) })
  .then((response) => response.ok)
  .catch(() => false)

describe.skipIf(!minioUp)('the whole path, against a real bucket', () => {
  it('uploads through the route, then reads it back as an attachment', async () => {
    const blobs = s3Blobs({
      bucket: 'helpdeck-attachments',
      endpoint: MINIO,
      accessKeyId: 'helpdeck',
      secretAccessKey: 'helpdeck-secret',
      region: 'us-east-1',
    })

    const upload = await uploadRoute({ blobs, secret: SECRET })(
      post('order 1042 was delivered to the wrong address', {
        'x-file-type': 'text/plain',
        'x-file-name': 'complaint.txt',
      }),
    )
    const reference = (await upload.json()) as { key: string; token: string; name: string }

    const resolved = await resolveStoredAttachments(
      [{ name: reference.name, mimeType: 'text/plain', key: reference.key, token: reference.token }],
      { blobs, secret: SECRET },
    )

    expect(resolved.rejected).toHaveLength(0)
    expect(atob(resolved.accepted[0]?.dataUrl?.split(',')[1] as string)).toContain('order 1042')

    await blobs.delete(reference.key)
  })

  it('issues a signed url the browser uploads to, and resolves what lands', async () => {
    const blobs = s3Blobs({
      bucket: 'helpdeck-attachments',
      endpoint: MINIO,
      accessKeyId: 'helpdeck',
      secretAccessKey: 'helpdeck-secret',
      region: 'us-east-1',
    })

    const issued = await uploadUrlRoute({ blobs, secret: SECRET })(
      post('', { 'x-file-type': 'text/plain', 'x-file-name': 'receipt.txt' }),
    )
    const ticket = (await issued.json()) as {
      key: string
      token: string
      url: string
      headers: Record<string, string>
    }

    // What the browser does, with nothing crossing the server.
    const put = await fetch(ticket.url, {
      method: 'PUT',
      headers: ticket.headers,
      body: 'total 19.99',
    })
    expect(put.status).toBe(200)

    const resolved = await resolveStoredAttachments(
      [{ name: 'receipt.txt', mimeType: 'text/plain', key: ticket.key, token: ticket.token }],
      { blobs, secret: SECRET },
    )

    expect(atob(resolved.accepted[0]?.dataUrl?.split(',')[1] as string)).toBe('total 19.99')

    await blobs.delete(ticket.key)
  })

  it('hands an image to the model as a signed link rather than as bytes', async () => {
    const blobs = s3Blobs({
      bucket: 'helpdeck-attachments',
      endpoint: MINIO,
      accessKeyId: 'helpdeck',
      secretAccessKey: 'helpdeck-secret',
      region: 'us-east-1',
    })

    const key = `test/photo-${Date.now()}.png`
    await blobs.put(key, new Uint8Array([137, 80, 78, 71]), { mimeType: 'image/png' })

    const resolved = await resolveStoredAttachments(
      [{ name: 'photo.png', mimeType: 'image/png', key, token: await signReference(SECRET, key) }],
      { blobs, secret: SECRET },
    )

    // Bytes would work too, and cost this server the download and the model
    // the base64. The link is the point of putting it in a bucket.
    const url = resolved.accepted[0]?.url as string
    expect(url).toContain('X-Amz-Signature')
    expect((await fetch(url)).status).toBe(200)

    await blobs.delete(key)
  })

  it('sends an image as bytes when asked to, for a model that cannot fetch', async () => {
    const blobs = s3Blobs({
      bucket: 'helpdeck-attachments',
      endpoint: MINIO,
      accessKeyId: 'helpdeck',
      secretAccessKey: 'helpdeck-secret',
      region: 'us-east-1',
    })

    const key = `test/photo-inline-${Date.now()}.png`
    await blobs.put(key, new Uint8Array([137, 80, 78, 71]), { mimeType: 'image/png' })

    const resolved = await resolveStoredAttachments(
      [{ name: 'photo.png', mimeType: 'image/png', key, token: await signReference(SECRET, key) }],
      { blobs, secret: SECRET, inlineImages: true },
    )

    expect(resolved.accepted[0]?.url).toBeUndefined()
    expect(resolved.accepted[0]?.dataUrl).toContain('data:image/png;base64,')

    await blobs.delete(key)
  })

  it('rejects a reference whose upload never happened', async () => {
    // The token is issued before the bytes arrive, so this is the case that
    // decides whether an abandoned upload becomes a confusing answer.
    const blobs = s3Blobs({
      bucket: 'helpdeck-attachments',
      endpoint: MINIO,
      accessKeyId: 'helpdeck',
      secretAccessKey: 'helpdeck-secret',
      region: 'us-east-1',
    })

    const issued = await uploadUrlRoute({ blobs, secret: SECRET })(
      post('', { 'x-file-type': 'text/plain', 'x-file-name': 'never-sent.txt' }),
    )
    const ticket = (await issued.json()) as { key: string; token: string }

    const resolved = await resolveStoredAttachments(
      [{ name: 'never-sent.txt', mimeType: 'text/plain', key: ticket.key, token: ticket.token }],
      { blobs, secret: SECRET },
    )

    expect(resolved.accepted).toHaveLength(0)
    expect(resolved.rejected[0]?.reason).toBe('that file is no longer available')
  })
})
