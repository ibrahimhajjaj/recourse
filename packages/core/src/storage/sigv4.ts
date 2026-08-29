/**
 * AWS Signature Version 4, written against Web Crypto.
 *
 * Every S3-compatible service authenticates this way, R2, MinIO, Backblaze,
 * Wasabi, S3 itself, so this one file is what lets object storage be a seam
 * rather than a vendor.
 *
 * It exists instead of a dependency for the reason the D1 store has no
 * `@cloudflare/workers-types`: the signing algorithm is a hundred lines of
 * HMAC and string concatenation, and a package that pulls in a Node crypto
 * shim would undo the property that the worker bundle guard protects.
 *
 * Two ways to sign, because they answer different questions:
 *
 * - `signHeaders` puts the signature in an `Authorization` header. For calls
 *   your server makes itself.
 * - `presign` puts it in the query string, so a URL alone is the credential.
 *   For handing a browser a link that uploads or downloads one object, once,
 *   for a while. Treat those URLs as bearer tokens, because that is what they
 *   are.
 */

const encoder = new TextEncoder()

const ALGORITHM = 'AWS4-HMAC-SHA256'

/** What S3 calls an empty body's hash. Precomputed so an empty PUT is cheap. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** The stand-in hash for a body the signature deliberately does not cover. */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

export interface Credentials {
  accessKeyId: string
  secretAccessKey: string
  /** Temporary credentials carry one, and it has to be signed alongside them. */
  sessionToken?: string
}

export interface SigningScope {
  /** R2 wants `auto`. Everyone else wants a real region. */
  region: string
  /** `s3` for object storage. */
  service: string
}

export interface SignHeadersOptions {
  method: string
  url: string
  headers?: Record<string, string>
  /** Hex SHA-256 of the body. `UNSIGNED_PAYLOAD` when it is a stream. */
  payloadHash: string
  credentials: Credentials
  scope: SigningScope
  /** Fixed time, for tests. */
  now?: Date
}

export interface PresignOptions {
  method: string
  url: string
  /** Signed alongside the URL, so the client must send them unchanged. */
  headers?: Record<string, string>
  /** Seconds the link stays valid. R2 and S3 both cap this at seven days. */
  expiresIn: number
  credentials: Credentials
  scope: SigningScope
  now?: Date
}

/** Seven days, the longest expiry S3 signature v4 permits. */
export const MAX_EXPIRES_IN = 604_800

/**
 * Signs a request and returns the headers to send with it.
 *
 * `host` is always signed, it is the minimum the specification requires, and
 * it is what stops a signature for one bucket being replayed against another.
 */
export async function signHeaders(options: SignHeadersOptions): Promise<Record<string, string>> {
  const url = new URL(options.url)
  const now = options.now ?? new Date()
  const { amzDate, dateStamp } = timestamps(now)

  const headers: Record<string, string> = {
    ...lowercaseKeys(options.headers ?? {}),
    host: url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': options.payloadHash,
  }
  if (options.credentials.sessionToken) {
    headers['x-amz-security-token'] = options.credentials.sessionToken
  }

  const { canonicalHeaders, signedHeaders } = canonicalizeHeaders(headers)

  const canonicalRequest = [
    options.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    options.payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${options.scope.region}/${options.scope.service}/aws4_request`
  const signature = await sign(canonicalRequest, credentialScope, amzDate, options)

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${options.credentials.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/**
 * Signs a URL so that possession of it is the authorisation.
 *
 * The payload is deliberately unsigned: the signature is computed before the
 * body exists, since the whole point is that somebody else supplies it.
 */
export async function presign(options: PresignOptions): Promise<string> {
  const url = new URL(options.url)
  const now = options.now ?? new Date()
  const { amzDate, dateStamp } = timestamps(now)

  const expiresIn = Math.min(Math.max(Math.floor(options.expiresIn), 1), MAX_EXPIRES_IN)
  const credentialScope = `${dateStamp}/${options.scope.region}/${options.scope.service}/aws4_request`

  const headers: Record<string, string> = {
    ...lowercaseKeys(options.headers ?? {}),
    host: url.host,
  }
  const { canonicalHeaders, signedHeaders } = canonicalizeHeaders(headers)

  const query = new URLSearchParams(url.searchParams)
  query.set('X-Amz-Algorithm', ALGORITHM)
  query.set('X-Amz-Credential', `${options.credentials.accessKeyId}/${credentialScope}`)
  query.set('X-Amz-Date', amzDate)
  query.set('X-Amz-Expires', String(expiresIn))
  query.set('X-Amz-SignedHeaders', signedHeaders)
  if (options.credentials.sessionToken) {
    query.set('X-Amz-Security-Token', options.credentials.sessionToken)
  }

  const canonicalRequest = [
    options.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join('\n')

  const signature = await sign(canonicalRequest, credentialScope, amzDate, options)
  query.set('X-Amz-Signature', signature)

  // Built by hand rather than through `URLSearchParams.toString()`, which
  // encodes a space as `+`. S3 canonicalises it as `%20`, and a mismatch there
  // is a signature failure that looks like a credentials problem.
  const search = [...query.entries()]
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&')

  return `${url.origin}${url.pathname}?${search}`
}

async function sign(
  canonicalRequest: string,
  credentialScope: string,
  amzDate: string,
  options: { credentials: Credentials; scope: SigningScope },
): Promise<string> {
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    await sha256Hex(encoder.encode(canonicalRequest)),
  ].join('\n')

  const dateStamp = credentialScope.slice(0, 8)
  let key = await hmac(encoder.encode(`AWS4${options.credentials.secretAccessKey}`), dateStamp)
  key = await hmac(key, options.scope.region)
  key = await hmac(key, options.scope.service)
  key = await hmac(key, 'aws4_request')

  return toHex(await hmac(key, stringToSign))
}

function timestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = value
  return out
}

function canonicalizeHeaders(headers: Record<string, string>): {
  canonicalHeaders: string
  signedHeaders: string
} {
  const names = Object.keys(headers).sort()
  return {
    // Values are trimmed and their internal runs of whitespace collapsed,
    // because that is what the receiving end will compare against.
    canonicalHeaders: names
      .map((name) => `${name}:${String(headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`)
      .join(''),
    signedHeaders: names.join(';'),
  }
}

/**
 * The path, with each segment encoded once.
 *
 * S3 is the exception to AWS's usual double-encoding rule: an object key
 * containing a space signs as `%20`, not `%2520`. Slashes stay slashes, since
 * a key is allowed to look like a directory.
 */
function canonicalPath(pathname: string): string {
  if (!pathname || pathname === '/') return '/'
  return pathname
    .split('/')
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join('/')
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

/**
 * RFC 3986 encoding. `encodeURIComponent` leaves `!'()*` alone and AWS does
 * not, which is a one-character difference that fails a whole signature.
 */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.byteLength === 0 ? new Uint8Array() : bytes
  return toHex(await crypto.subtle.digest('SHA-256', buffer as unknown as BufferSource))
}

async function hmac(key: Uint8Array | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', imported, encoder.encode(message))
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
