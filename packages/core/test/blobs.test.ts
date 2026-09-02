import { describe, expect, it } from 'vitest'
import { blobBehaviour, bytes } from './blobs-suite.js'
import { blobKey, memoryBlobs, type Blobs } from '../src/storage/blobs.js'
import { r2Blobs, type R2Like, type R2ObjectBodyLike, type R2ObjectLike } from '../src/storage/r2-binding.js'
import { s3Blobs } from '../src/storage/s3.js'

blobBehaviour('memory', () => memoryBlobs())

/**
 * A stand-in for the Workers R2 binding.
 *
 * It proves the adapter's translation, metadata in and out, a null return
 * treated as a failure, and nothing about R2 itself. What proves R2 is the
 * worker example running against `wrangler dev`, which uses a real binding.
 */
function fakeBucket(): R2Like {
  const objects = new Map<string, { body: Uint8Array; object: R2ObjectLike }>()

  return {
    async put(key, value, options) {
      const stored =
        value instanceof Uint8Array ? value.slice() : new Uint8Array(value as ArrayBuffer)
      const object: R2ObjectLike = {
        key,
        size: stored.byteLength,
        etag: 'fake',
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
      }
      objects.set(key, { body: stored, object })
      return object
    },
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      const body: R2ObjectBodyLike = {
        ...found.object,
        arrayBuffer: async () => found.body.slice().buffer as ArrayBuffer,
      }
      return body
    },
    async head(key) {
      return objects.get(key)?.object ?? null
    },
    async delete(key) {
      const keys = Array.isArray(key) ? key : [key]
      for (const one of keys) objects.delete(one)
    },
  }
}

blobBehaviour('r2 binding', () => r2Blobs(fakeBucket()))

/**
 * MinIO, when it is running.
 *
 * It matters that this is a real S3 server rather than a mock: the signature
 * is computed here and checked there, so a wrong canonical request fails the
 * way it would against R2 instead of passing against a fixture that agrees
 * with whatever this code does.
 *
 *   docker run -d --name recourse-minio -p 59000:9000 \
 *     -e MINIO_ROOT_USER=recourse -e MINIO_ROOT_PASSWORD=recourse-secret \
 *     --entrypoint sh minio/minio -c "mkdir -p /data/recourse-attachments && exec minio server /data"
 *
 * The block below runs only when TEST_S3_ENDPOINT says where that server is,
 * and skips itself otherwise.
 */
// Only probed when somebody has said where the server is. Reaching for a
// fixed port on every run means a stray connection attempt on a developer's
// machine, to a port that may well belong to something else of theirs.
const MINIO = process.env.TEST_S3_ENDPOINT

const minioUp = MINIO
  ? await fetch(`${MINIO}/minio/health/live`, { signal: AbortSignal.timeout(1500) })
      .then((response) => response.ok)
      .catch(() => false)
  : false

// Read only inside the block `describe.skipIf(!minioUp)` guards, and
// `minioUp` is false whenever there is no endpoint, so the empty string is
// unreachable rather than a silent default.
const ENDPOINT = MINIO ?? ''

function minio(): Blobs {
  return s3Blobs({
    bucket: 'recourse-attachments',
    endpoint: ENDPOINT,
    accessKeyId: 'recourse',
    secretAccessKey: 'recourse-secret',
    region: 'us-east-1',
  })
}

describe.skipIf(!minioUp)('s3 against minio', () => {
  blobBehaviour('s3', () => minio())

  it('signs a url a browser can read without credentials', async () => {
    const blobs = minio()
    const key = `test/signed-${Date.now()}.txt`
    await blobs.put(key, bytes('read me'), { mimeType: 'text/plain' })

    const url = await blobs.signedUrl?.(key, { expiresIn: 60 })
    const response = await fetch(url as string)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('read me')
  })

  it('signs a url a browser can upload to without credentials', async () => {
    const blobs = minio()
    const key = `test/direct-${Date.now()}.txt`

    const upload = await blobs.signedUpload?.(key, { mimeType: 'text/plain', expiresIn: 60 })
    const put = await fetch(upload?.url as string, {
      method: 'PUT',
      headers: upload?.headers,
      body: 'uploaded from the browser',
    })

    expect(put.status).toBe(200)
    expect(new TextDecoder().decode((await blobs.get(key))?.bytes)).toBe('uploaded from the browser')
  })

  it('refuses an upload that changes the content type it was signed for', async () => {
    const blobs = minio()
    const upload = await blobs.signedUpload?.(`test/mismatch-${Date.now()}.txt`, {
      mimeType: 'text/plain',
      expiresIn: 60,
    })

    // The signature covers the header, so this is not a matter of the server
    // being polite about types: the request no longer verifies at all.
    const put = await fetch(upload?.url as string, {
      method: 'PUT',
      headers: { 'content-type': 'text/html' },
      body: '<script>alert(1)</script>',
    })

    expect(put.ok).toBe(false)
  })

  it('refuses a signed url once it has expired', async () => {
    const blobs = minio()
    const key = `test/expired-${Date.now()}.txt`
    await blobs.put(key, bytes('secret'), { mimeType: 'text/plain' })

    const url = await blobs.signedUrl?.(key, { expiresIn: 1 })
    await new Promise((resolve) => setTimeout(resolve, 1600))

    expect((await fetch(url as string)).status).toBe(403)
  })

  it('names the S3 error code rather than only the status', async () => {
    const wrong = s3Blobs({
      bucket: 'recourse-attachments',
      endpoint: ENDPOINT,
      accessKeyId: 'recourse',
      secretAccessKey: 'not-the-password',
      region: 'us-east-1',
    })

    await expect(wrong.put('test/denied.txt', bytes('x'), { mimeType: 'text/plain' })).rejects.toThrow(
      /SignatureDoesNotMatch/,
    )
  })

  it('round trips a key with a space and a plus in it', async () => {
    const blobs = minio()
    // Both characters are encoded differently by the two obvious spellings of
    // "url encode", and getting it wrong fails the signature rather than the
    // upload, which is a confusing way to find out.
    const key = `test/holiday photo +1.txt`
    await blobs.put(key, bytes('encoded'), { mimeType: 'text/plain' })

    expect(new TextDecoder().decode((await blobs.get(key))?.bytes)).toBe('encoded')
  })
})

describe('keys', () => {
  // A filename arrives from whoever is uploading, and every one of these is a
  // real shape rather than a hypothetical: back slashes for Windows, doubled
  // dots that survive a naive single strip, percent encoding for a layer that
  // decodes later, and a leading dot for a file a listing would hide.
  it.each([
    '../../etc/passwd',
    '..\\..\\windows\\system32\\config\\sam',
    '....//....//etc/shadow',
    '/absolute/path.pdf',
    'a/b/c.pdf',
    '%2e%2e%2fetc%2fpasswd',
    '.htaccess',
    '...',
    '',
  ])('keeps the visitor filename readable but harmless: %j', (name) => {
    const key = blobKey(name)

    expect(key).toMatch(/^attachments\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{18}-/)

    // Only the last segment comes from the name. The prefix and the date are
    // ours, so a slash surviving into the tail is the thing that would matter.
    const tail = key.split('/').slice(2).join('/')
    expect(tail).not.toContain('..')
    expect(tail).not.toContain('/')
    expect(tail).not.toContain('\\')
    expect(key.startsWith('/')).toBe(false)
  })

  it('does not collide when two people upload the same name', () => {
    const keys = new Set(Array.from({ length: 200 }, () => blobKey('invoice.pdf')))
    expect(keys.size).toBe(200)
  })

  it('stays well inside the 1024 byte limit however long the name is', () => {
    expect(blobKey('x'.repeat(4000)).length).toBeLessThan(200)
  })

  it('keeps the extension when the name itself has no ASCII in it', () => {
    // Everything before the dot reduces to nothing, and taking the extension
    // with it turns a PDF into a file nothing knows how to open.
    expect(blobKey('فاتورة.pdf').endsWith('.pdf')).toBe(true)
    expect(blobKey('发票.png').endsWith('.png')).toBe(true)
  })

  it('does not let a double extension survive as one', () => {
    expect(blobKey('report.pdf.exe').endsWith('.exe')).toBe(true)
  })
})
