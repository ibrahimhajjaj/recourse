/**
 * Somewhere to put a file that is not the request body.
 *
 * Attachments shipped two ways: inline base64, which rides the same request as
 * the question, and a `url` the host already serves, which had nothing behind
 * it. This is what goes behind it.
 *
 * Inline has a hard ceiling wherever it is deployed. Base64 inflates a file by
 * a third, a Worker refuses a request body over 100MB, and a D1 row cannot
 * exceed 2MB, so anything larger than a screenshot has to live somewhere else
 * regardless of who is hosting.
 *
 * The interface is deliberately small, put, get, head, delete, and two
 * optional signing methods, because that is the intersection of R2, S3,
 * MinIO, Backblaze, and a directory on a disk. Anything richer would be an S3
 * client wearing a seam's clothes.
 */

export interface StoredBlob {
  key: string
  size: number
  mimeType: string
  /** Whatever the provider calls this version. Absent on some backends. */
  etag?: string
  /** The name it was uploaded under, when one was recorded. */
  filename?: string
}

export interface BlobContent extends StoredBlob {
  bytes: Uint8Array
}

export interface PutOptions {
  mimeType?: string
  /** Kept as metadata, so a download can be saved under the original name. */
  filename?: string
  /** Small key/value pairs. R2 and S3 both cap the whole set at 8KB. */
  metadata?: Record<string, string>
  signal?: AbortSignal
}

export interface SignedUrlOptions {
  /** Seconds the link stays valid. Five minutes by default. */
  expiresIn?: number
  /** Offers the file as a download under this name rather than rendering it. */
  download?: string
}

export interface SignedUploadOptions extends SignedUrlOptions {
  /** Signed into the URL, so the browser has to send exactly this type. */
  mimeType?: string
}

export interface SignedUpload {
  url: string
  /** Headers the client must send unchanged, or the signature will not match. */
  headers: Record<string, string>
  expiresAt: string
}

export interface Blobs {
  /** Named so a failure says which backend failed. */
  name: string
  put(key: string, body: Uint8Array, options?: PutOptions): Promise<StoredBlob>
  get(key: string): Promise<BlobContent | null>
  head(key: string): Promise<StoredBlob | null>
  delete(key: string): Promise<void>
  /**
   * A URL something outside this process can read the object through.
   *
   * Signed and expiring where the backend can sign, that is the S3 path, and
   * a plain public URL where it cannot, which is what a bucket with a custom
   * domain in front of it gives you. The difference matters: one leaks for
   * five minutes, the other leaks forever.
   *
   * Optional because a Workers R2 binding has no signing API at all, and
   * without a public domain there is simply no such URL to hand out.
   */
  signedUrl?(key: string, options?: SignedUrlOptions): Promise<string>
  /**
   * A time-limited link the browser can PUT to, so a large file never passes
   * through the server at all.
   */
  signedUpload?(key: string, options?: SignedUploadOptions): Promise<SignedUpload>
}

/** Five minutes. Long enough to click, short enough that a leak expires. */
export const DEFAULT_EXPIRES_IN = 300

/**
 * A key for one uploaded file.
 *
 * The random part comes before the visitor's filename so that two people
 * uploading `invoice.pdf` never collide, R2 rate limits concurrent writes to
 * the *same* key to one per second, and a shared name would find that limit.
 * The name is kept on the end because a key that reads `a7f3c2e9d1b4` tells
 * whoever opens the bucket nothing at all.
 */
export function blobKey(name: string, prefix = 'attachments'): string {
  const dot = (name || '').lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name || 'file'
  // Kept separately, because a name in a script with no ASCII in it reduces to
  // nothing and would otherwise take the extension down with it. `فاتورة.pdf`
  // has to stay a PDF.
  const extension = (dot > 0 ? name.slice(dot + 1) : '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10)

  const clean =
    stem
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+/, '')
      .replace(/[-.]+$/, '')
      .slice(0, 80) || 'file'

  const day = new Date().toISOString().slice(0, 10)

  // Keys are capped at 1024 bytes and every part here is ASCII and bounded, so
  // the result cannot approach it.
  return `${prefix}/${day}/${randomId()}-${clean}${extension ? `.${extension}` : ''}`
}

function randomId(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Object storage that forgets. For tests, and for a single-process demo.
 *
 * Deliberately has no `signedUrl`: a link that only works inside one process
 * would pass every test and fail every deployment.
 */
export function memoryBlobs(): Blobs {
  const objects = new Map<string, BlobContent>()

  return {
    name: 'memory',

    async put(key, body, options = {}) {
      const stored: BlobContent = {
        key,
        bytes: body.slice(),
        size: body.byteLength,
        mimeType: options.mimeType ?? 'application/octet-stream',
        etag: `"${body.byteLength.toString(16)}"`,
        ...(options.filename ? { filename: options.filename } : {}),
      }
      objects.set(key, stored)
      const { bytes: _bytes, ...info } = stored
      return info
    },

    async get(key) {
      const found = objects.get(key)
      return found ? { ...found, bytes: found.bytes.slice() } : null
    },

    async head(key) {
      const found = objects.get(key)
      if (!found) return null
      const { bytes: _bytes, ...info } = found
      return info
    },

    async delete(key) {
      objects.delete(key)
    },
  }
}
