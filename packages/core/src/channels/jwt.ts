/**
 * Just enough JWT verification for Bot Framework traffic.
 *
 * Microsoft signs inbound activities with RS256 and publishes the keys at a
 * well-known URL. Verifying properly means fetching those keys, matching the
 * one named in the header, checking the signature, and only then trusting the
 * claims. Skipping any of that leaves an endpoint that accepts a token anybody
 * can mint, which is the same as no authentication at all.
 *
 * Written on Web Crypto rather than a JWT library so it runs on Workers and
 * Deno, and so there is one less dependency to keep current.
 */

export interface JwtHeader {
  alg?: string
  kid?: string
  typ?: string
}

export interface JwtClaims {
  iss?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  serviceurl?: string
  [claim: string]: unknown
}

interface Jwk {
  kid?: string
  kty?: string
  n?: string
  e?: string
  alg?: string
  use?: string
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(segment))) as T
  } catch {
    return null
  }
}

/** Keys are stable for a long time, and refetching them per request is silly. */
const keyCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>()
const KEY_TTL_MS = 60 * 60 * 1000

export async function fetchSigningKeys(openIdUrl: string, now = Date.now()): Promise<Jwk[]> {
  const cached = keyCache.get(openIdUrl)
  if (cached && now - cached.fetchedAt < KEY_TTL_MS) return cached.keys

  const configuration = (await (await fetch(openIdUrl)).json()) as { jwks_uri?: string }
  if (!configuration.jwks_uri) throw new Error('the OpenID configuration has no jwks_uri')

  const jwks = (await (await fetch(configuration.jwks_uri)).json()) as { keys?: Jwk[] }
  const keys = jwks.keys ?? []

  keyCache.set(openIdUrl, { keys, fetchedAt: now })
  return keys
}

/** Clears the cache. Exported for tests and for key rotation emergencies. */
export function clearKeyCache(): void {
  keyCache.clear()
}

export interface VerifyJwtOptions {
  token: string
  /** Where to find the signing keys. */
  openIdUrl: string
  /** The issuer the token must claim. */
  issuer: string | string[]
  /** Your application id. A token minted for someone else is not for you. */
  audience: string
  /** Seconds of clock skew tolerated on exp and nbf. */
  leewaySeconds?: number
  now?: number
  /** Injected in tests so no network is needed. */
  keys?: Jwk[]
}

export async function verifyJwt(options: VerifyJwtOptions): Promise<JwtClaims | null> {
  const parts = options.token.split('.')
  if (parts.length !== 3) return null

  const header = decodeSegment<JwtHeader>(parts[0] as string)
  const claims = decodeSegment<JwtClaims>(parts[1] as string)
  if (!header || !claims) return null

  // Only RS256. Accepting "alg": "none", or an HMAC algorithm verified with a
  // public key, are the two classic ways to forge a JWT.
  if (header.alg !== 'RS256') return null

  const keys = options.keys ?? (await fetchSigningKeys(options.openIdUrl))
  const jwk = keys.find((candidate) => candidate.kid === header.kid)
  if (!jwk?.n || !jwk.e) return null

  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  } catch {
    return null
  }

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    fromBase64Url(parts[2] as string),
    signed,
  )
  if (!valid) return null

  const now = Math.floor((options.now ?? Date.now()) / 1000)
  const leeway = options.leewaySeconds ?? 60

  // A token with no expiry is a token that never expires, and one whose exp is
  // a string skips a check that only looked at numbers. Both come off the
  // network as JSON, where the declared types prove nothing, so the shape is
  // checked here rather than assumed.
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null
  if (now > claims.exp + leeway) return null

  if (claims.nbf !== undefined) {
    if (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf)) return null
    if (now < claims.nbf - leeway) return null
  }

  const issuers = Array.isArray(options.issuer) ? options.issuer : [options.issuer]
  if (!claims.iss || !issuers.includes(claims.iss)) return null

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(options.audience)) return null

  return claims
}
