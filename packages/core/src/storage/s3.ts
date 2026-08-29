/**
 * Object storage over the S3 API, which R2 also speaks.
 *
 * This is the portable half of the seam. The same function backs Cloudflare
 * R2, MinIO on a box in a cupboard, Backblaze B2, Wasabi and S3 itself,
 * because all of them answer the same five verbs signed the same way.
 *
 * It is `fetch` and `crypto.subtle` and nothing else, so it runs on a Worker,
 * on Node, on Deno and on Bun without a build step or a polyfill.
 *
 * The one thing worth knowing before choosing this over the R2 binding: a
 * binding talks to R2 over Cloudflare's internal network with no signature and
 * no credentials to leak. Use `r2Blobs` from `r2-binding.ts` when the code runs
 * on a Worker; use
 * this when it does not, or when you want a presigned URL, which a binding
 * cannot produce.
 */

import type {
  Blobs,
  BlobContent,
  PutOptions,
  SignedUpload,
  SignedUploadOptions,
  SignedUrlOptions,
  StoredBlob,
} from './blobs.js'
import { DEFAULT_EXPIRES_IN } from './blobs.js'
import { encodeRfc3986, presign, sha256Hex, signHeaders, type Credentials } from './sigv4.js'

export interface S3BlobsOptions {
  bucket: string
  /**
   * The service root, without the bucket.
   *
   * R2: `https://<account id>.r2.cloudflarestorage.com`
   * MinIO: `http://localhost:9000`
   * S3: `https://s3.<region>.amazonaws.com`
   */
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  /** Temporary credentials only. */
  sessionToken?: string
  /** R2 wants `auto`, which is also the default. S3 wants a real region. */
  region?: string
  /**
   * Where the bucket goes in the URL. Path style (`/bucket/key`) is what R2
   * and MinIO both accept, and it avoids needing DNS per bucket.
   */
  pathStyle?: boolean
  /**
   * A public base for read URLs: an R2 custom domain, or a CDN in front of
   * the bucket. When set, `signedUrl` is not needed to show a file.
   *
   * Cloudflare's `r2.dev` subdomain is explicitly not for production: it is
   * rate limited, throttled, and will start answering 429 under real traffic.
   * Put a custom domain on the bucket instead.
   */
  publicBase?: string
  /** Swappable for tests. */
  fetch?: typeof fetch
}

/**
 * R2 through its S3 API, which is the path that can sign URLs.
 *
 * Presigned URLs work only against the S3 endpoint. They cannot be used with a
 * custom domain, which is a documented R2 limitation and not something a
 * client library can work around.
 */
export function r2S3Blobs(
  options: Omit<S3BlobsOptions, 'endpoint' | 'region'> & { accountId: string; region?: string },
): Blobs {
  const { accountId, ...rest } = options
  return s3Blobs({
    ...rest,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: options.region ?? 'auto',
  })
}

export function s3Blobs(options: S3BlobsOptions): Blobs {
  const call = options.fetch ?? fetch
  const scope = { region: options.region ?? 'auto', service: 's3' }
  const credentials: Credentials = {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
  }
  const root = options.endpoint.replace(/\/+$/, '')
  const pathStyle = options.pathStyle ?? true

  function objectUrl(key: string): string {
    // Each segment is encoded, and the separators are not, so a key that looks
    // like a path stays one.
    const encoded = key.split('/').map(encodeRfc3986).join('/')
    if (pathStyle) return `${root}/${encodeRfc3986(options.bucket)}/${encoded}`
    const url = new URL(root)
    return `${url.protocol}//${options.bucket}.${url.host}/${encoded}`
  }

  async function send(
    method: string,
    key: string,
    body?: Uint8Array,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = objectUrl(key)
    const payloadHash = await sha256Hex(body ?? new Uint8Array())
    const signed = await signHeaders({ method, url, headers, payloadHash, credentials, scope })

    return call(url, {
      method,
      headers: signed,
      ...(body ? { body: body as unknown as BodyInit } : {}),
      ...(signal ? { signal } : {}),
    })
  }

  function describe(key: string, response: Response): StoredBlob {
    const filename = response.headers.get('x-amz-meta-filename')
    return {
      key,
      size: Number(response.headers.get('content-length') ?? 0),
      mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag') as string } : {}),
      // Metadata comes back percent-encoded, because header values are ASCII
      // and a filename very often is not.
      ...(filename ? { filename: safeDecode(filename) } : {}),
    }
  }

  return {
    name: 's3',

    async put(key, body, putOptions: PutOptions = {}) {
      const headers: Record<string, string> = {
        'content-type': putOptions.mimeType ?? 'application/octet-stream',
        'content-length': String(body.byteLength),
      }
      if (putOptions.filename) headers['x-amz-meta-filename'] = encodeRfc3986(putOptions.filename)
      for (const [name, value] of Object.entries(putOptions.metadata ?? {})) {
        headers[`x-amz-meta-${name.toLowerCase()}`] = encodeRfc3986(value)
      }

      const response = await send('PUT', key, body, headers, putOptions.signal)
      if (!response.ok) throw await failure('store', key, response)
      await response.arrayBuffer()

      return {
        key,
        size: body.byteLength,
        mimeType: headers['content-type'] as string,
        ...(response.headers.get('etag') ? { etag: response.headers.get('etag') as string } : {}),
        ...(putOptions.filename ? { filename: putOptions.filename } : {}),
      }
    },

    async get(key): Promise<BlobContent | null> {
      const response = await send('GET', key)
      if (response.status === 404) {
        await response.arrayBuffer()
        return null
      }
      if (!response.ok) throw await failure('read', key, response)

      const bytes = new Uint8Array(await response.arrayBuffer())
      return { ...describe(key, response), size: bytes.byteLength, bytes }
    },

    async head(key) {
      const response = await send('HEAD', key)
      if (response.status === 404) return null
      if (!response.ok) throw await failure('read', key, response)
      return describe(key, response)
    },

    async delete(key) {
      const response = await send('DELETE', key)
      // S3 deletes are idempotent: removing what is not there is a success,
      // and 404 here means the bucket is missing, not the object.
      if (!response.ok && response.status !== 404) throw await failure('delete', key, response)
      await response.arrayBuffer()
    },

    async signedUrl(key, urlOptions: SignedUrlOptions = {}) {
      // A public base is public: no signature, no expiry, and `download` has
      // nowhere to go. Setting one is a decision that these objects are not
      // secret, and it is worth being sure of that before you do.
      if (options.publicBase) {
        return `${options.publicBase.replace(/\/+$/, '')}/${key.split('/').map(encodeRfc3986).join('/')}`
      }

      const url = new URL(objectUrl(key))
      if (urlOptions.download) {
        url.searchParams.set(
          'response-content-disposition',
          `attachment; filename="${urlOptions.download.replace(/["\\]/g, '')}"`,
        )
      }

      return presign({
        method: 'GET',
        url: url.toString(),
        expiresIn: urlOptions.expiresIn ?? DEFAULT_EXPIRES_IN,
        credentials,
        scope,
      })
    },

    async signedUpload(key, uploadOptions: SignedUploadOptions = {}): Promise<SignedUpload> {
      const expiresIn = uploadOptions.expiresIn ?? DEFAULT_EXPIRES_IN
      // Signing the content type means a leaked URL can only put back the kind
      // of file it was issued for. The client has to send it verbatim, which
      // is why it is handed back rather than merely documented.
      const headers: Record<string, string> = uploadOptions.mimeType
        ? { 'content-type': uploadOptions.mimeType }
        : {}

      const url = await presign({
        method: 'PUT',
        url: objectUrl(key),
        headers,
        expiresIn,
        credentials,
        scope,
      })

      return { url, headers, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
    },
  }
}

/**
 * S3 errors arrive as XML, and the useful part is the code.
 *
 * The body is read and named because the alternative, a bare status, turns
 * "your clock is nine minutes fast" and "that key does not exist" into the
 * same message.
 */
async function failure(verb: string, key: string, response: Response): Promise<Error> {
  const body = await response.text().catch(() => '')
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1]
  const detail = code ? `${code} (${response.status})` : String(response.status)
  return new Error(`could not ${verb} "${key}": ${detail}`)
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
