/**
 * Where a file goes before the question that mentions it.
 *
 * Two routes, because there are two ways to get bytes into a bucket and they
 * fail at different sizes:
 *
 * - `uploadRoute` takes the file through your server. One request, no
 *   credentials anywhere near the browser, works against every backend
 *   including the in-memory one. It is bounded by whatever your host will
 *   accept as a request body, 100MB on a Worker, 4.5MB on some serverless
 *   platforms, and that is before base64 adds a third.
 * - `uploadUrlRoute` hands back a signed URL and the browser PUTs to the
 *   bucket directly. Nothing but a few hundred bytes crosses your server, so
 *   the host's body limit stops mattering. Needs a backend that can sign, and
 *   needs CORS configured on the bucket.
 *
 * Both answer with the same `{ key, token }`, so the widget sends the same
 * thing back either way and can be switched between them by configuration.
 *
 * This is a public endpoint that writes to storage you pay for. Every limit
 * here exists because of that sentence.
 */

import {
  DEFAULT_ALLOWED_TYPES,
  sanitiseName,
  type AttachmentPolicy,
} from '../attachments.js'
import { blobKey, type Blobs } from '../storage/blobs.js'
import { signReference, verifyReference } from '../storage/references.js'
import { corsHeaders, type CorsOptions } from './cors.js'
import type { RateLimiter } from './ratelimit.js'

export interface UploadRouteOptions {
  blobs: Blobs
  /**
   * Signs the keys this route hands out. Any long random string; the same one
   * the chat handler verifies with.
   */
  secret: string
  /** Media types accepted, and how large. Matches the chat handler's policy. */
  policy?: Pick<AttachmentPolicy, 'allow' | 'maxBytes'>
  cors?: CorsOptions
  /**
   * Strongly recommended. Without one, an open endpoint that writes to storage
   * you are billed for is one script away from being someone else's disk.
   */
  rateLimit?: Pick<RateLimiter, 'check'>
  /** Where keys are written, so attachments are separable from anything else. */
  prefix?: string
}

/** 25MB. Larger than the inline cap, because that is the point of a bucket. */
export const DEFAULT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024

export interface UploadUrlRouteOptions extends UploadRouteOptions {
  /** Seconds the signed link stays valid. Five minutes by default. */
  expiresIn?: number
}

interface Checked {
  name: string
  mimeType: string
  declared: number
}

function check(request: Request, options: UploadRouteOptions): Checked | { error: string; status: number } {
  const allow = options.policy?.allow ?? DEFAULT_ALLOWED_TYPES
  const maxBytes = options.policy?.maxBytes ?? DEFAULT_UPLOAD_MAX_BYTES

  const url = new URL(request.url)
  const mimeType = (request.headers.get('x-file-type') ?? url.searchParams.get('type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase()

  if (!mimeType || !allow.includes(mimeType)) {
    return { error: `${mimeType || 'that file type'} is not accepted`, status: 415 }
  }

  // The name is display text and part of the key. It never becomes a path:
  // `sanitiseName` takes the separators out, and the key is built from a
  // fixed prefix regardless of what arrives.
  const name = sanitiseName(
    request.headers.get('x-file-name') ?? url.searchParams.get('name') ?? 'file',
  )

  const declared = Number(request.headers.get('content-length') ?? url.searchParams.get('size') ?? 0)
  if (declared > maxBytes) {
    return { error: `files must be under ${Math.round(maxBytes / 1024 / 1024)}MB`, status: 413 }
  }

  return { name, mimeType, declared }
}

async function limited(request: Request, options: UploadRouteOptions): Promise<boolean> {
  if (!options.rateLimit) return false
  const caller = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const gate = await options.rateLimit.check(caller)
  return !gate.ok
}

/** Takes the file through this server and stores it. */
export function uploadRoute(options: UploadRouteOptions) {
  const maxBytes = options.policy?.maxBytes ?? DEFAULT_UPLOAD_MAX_BYTES

  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request, options.cors)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors)
    if (await limited(request, options)) return json({ error: 'too many requests' }, 429, cors)

    const checked = check(request, options)
    if ('error' in checked) return json({ error: checked.error }, checked.status, cors)

    const bytes = new Uint8Array(await request.arrayBuffer())
    if (bytes.byteLength === 0) return json({ error: 'the file was empty' }, 400, cors)
    // Checked again after reading, because `content-length` is a claim and a
    // chunked request does not have to make one.
    if (bytes.byteLength > maxBytes) {
      return json({ error: `files must be under ${Math.round(maxBytes / 1024 / 1024)}MB` }, 413, cors)
    }

    const key = blobKey(checked.name, options.prefix)

    try {
      await options.blobs.put(key, bytes, { mimeType: checked.mimeType, filename: checked.name })
    } catch (error) {
      console.warn(`[helpdeck] upload to ${options.blobs.name} failed: ${String(error)}`)
      return json({ error: 'could not store that file' }, 502, cors)
    }

    return json(
      {
        key,
        token: await signReference(options.secret, key),
        name: checked.name,
        mimeType: checked.mimeType,
        bytes: bytes.byteLength,
      },
      200,
      cors,
    )
  }
}

/**
 * Hands back a URL the browser PUTs to itself.
 *
 * The token is issued now, before the upload has happened, which is the only
 * option, this server never sees the bytes and gets no callback when they
 * arrive. That is safe because the token proves the key was *issued*, not that
 * it was filled: resolving a reference still checks the object exists, and an
 * unused key is an empty name in a bucket.
 *
 * The size a caller declares is trusted only as far as refusing an obviously
 * oversized one. What actually bounds the object is the bucket, which is why
 * a lifecycle rule on the prefix belongs in any real deployment.
 */
export function uploadUrlRoute(options: UploadUrlRouteOptions) {
  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request, options.cors)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST' && request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, cors)
    }
    if (!options.blobs.signedUpload) {
      return json({ error: 'this deployment cannot sign uploads' }, 501, cors)
    }
    if (await limited(request, options)) return json({ error: 'too many requests' }, 429, cors)

    const checked = check(request, options)
    if ('error' in checked) return json({ error: checked.error }, checked.status, cors)

    const key = blobKey(checked.name, options.prefix)

    try {
      const upload = await options.blobs.signedUpload(key, {
        mimeType: checked.mimeType,
        ...(options.expiresIn ? { expiresIn: options.expiresIn } : {}),
      })

      return json(
        {
          key,
          token: await signReference(options.secret, key),
          name: checked.name,
          mimeType: checked.mimeType,
          ...upload,
        },
        200,
        cors,
      )
    } catch (error) {
      console.warn(`[helpdeck] could not sign an upload for ${options.blobs.name}: ${String(error)}`)
      return json({ error: 'could not start that upload' }, 502, cors)
    }
  }
}

/**
 * Serves a stored object back.
 *
 * Needed when the bucket is private and the backend cannot sign a link, a
 * Workers R2 binding, for instance. The reference is verified exactly as it is
 * on the chat path: a key alone opens nothing.
 */
export function downloadRoute(options: Omit<UploadRouteOptions, 'policy' | 'rateLimit'> & {
  rateLimit?: Pick<RateLimiter, 'check'>
}) {
  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request, options.cors)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors)

    const url = new URL(request.url)
    const key = url.searchParams.get('key') ?? ''
    const token = url.searchParams.get('token') ?? ''

    if (!key || !token || !(await verifyReference(options.secret, key, token))) {
      return json({ error: 'not found' }, 404, cors)
    }

    const content = await options.blobs.get(key)
    if (!content) return json({ error: 'not found' }, 404, cors)

    return new Response(content.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': content.mimeType,
        'Content-Length': String(content.size),
        // Never inline: an HTML or SVG file served from your origin and
        // rendered as a document is a stored cross-site scripting hole.
        'Content-Disposition': disposition(content.filename ?? 'file'),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=60',
      },
    })
  }
}

/**
 * `Content-Disposition` for a name that is not necessarily ASCII.
 *
 * A header value is bytes, so `filename="فاتورة.pdf"` is read as latin-1 by
 * the browser and saved as mojibake. RFC 5987 exists for this: an ASCII
 * fallback for old clients, and the real name percent-encoded beside it.
 */
function disposition(filename: string): string {
  const safe = filename.replace(/["\\]/g, '').replace(/[^\u0020-\u007e]/g, '_') || 'file'
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
