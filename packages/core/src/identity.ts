import type { Contact } from './actions/types.js'

/**
 * Proves the visitor is who the host page says they are.
 *
 * Without this, a widget that can look up orders will happily look up anyone's:
 * the browser simply claims a user id and the server believes it. The host
 * signs the id server-side with a shared secret, the widget passes the
 * signature along, and actions that touch personal data check it before running.
 *
 * The scheme is HMAC-SHA256 of the user id, hex encoded, which is what every
 * comparable product uses. Existing server-side code that signs for one of them
 * signs for this unchanged.
 */

const encoder = new TextEncoder()

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
}

/** Run this on your server. Never ship the secret to the browser. */
export async function signIdentity(userId: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(userId))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Checks a signature in constant time.
 *
 * A naive `===` on a hex string leaks how many leading characters were right,
 * which is enough to forge one byte at a time given enough attempts.
 */
export async function verifyIdentity(userId: string, hash: string, secret: string): Promise<boolean> {
  if (typeof hash !== 'string' || hash.length !== 64) return false
  const expected = await signIdentity(userId, secret)
  return timingSafeEqual(expected, hash.toLowerCase())
}

/**
 * Facts about the visitor that actions may use and the model never sees.
 *
 * The tier that was missing. `contact.attributes` is interpolated into
 * procedure text, so anything put there can end up in the prompt and therefore
 * in an answer. A billing id, a date of birth or an internal account reference
 * belongs in a lookup, not in something a model is holding.
 *
 * Signed as one blob rather than field by field, because a browser passes it
 * through and an unsigned bag of "facts" from a browser is not a fact.
 *
 * ```ts
 * // On your server, where the secret lives.
 * const token = await signClaims({ stripeId: 'cus_123', dob: '1990-04-02' }, secret)
 *
 * // In an action, verified and never shown to the model.
 * const stripeId = ctx.private?.stripeId
 * ```
 */
export async function signClaims(claims: Record<string, unknown>, secret: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(claims)))
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body))

  return `${body}.${base64url(new Uint8Array(signature))}`
}

/**
 * Reads a token back, or null if it was not signed with this secret.
 *
 * Null rather than throwing, and null for every kind of failure: a forged
 * signature, a truncated token and a body that is not JSON are all the same
 * answer, which is that there are no verified claims here.
 */
export async function readClaims(
  token: string | undefined,
  secret: string,
): Promise<Record<string, unknown> | null> {
  if (!token || !secret) return null

  const at = token.lastIndexOf('.')
  if (at <= 0) return null

  const body = token.slice(0, at)
  const signature = token.slice(at + 1)

  const expected = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body))
  if (!timingSafeEqual(base64url(new Uint8Array(expected)), signature)) return null

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(body)))

    // An array or a string would satisfy `typeof === 'object'` badly enough to
    // reach an action as something it did not expect.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))

  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

export interface IdentityOptions {
  /** The shared secret. Read it from the environment, never from source. */
  secret: string
  /**
   * Rejects any request that fails verification, instead of downgrading it to
   * an anonymous visitor. Turn this on once your widget always signs.
   */
  required?: boolean
}

export interface IdentityClaim {
  userId?: string
  userHash?: string
  /** Anything else the host asserted about the visitor. */
  contact?: Omit<Contact, 'verified'>
  /**
   * A signed blob from {@link signClaims}, for facts the model must not see.
   *
   * Passed through by the browser and verified here. Unverified content is
   * discarded rather than downgraded: a claim an action will act on has to be
   * true or absent, and there is no useful third state.
   */
  token?: string
}

/**
 * Turns an unverified claim from the browser into a contact.
 *
 * A claim that fails verification still yields a contact, marked unverified,
 * so the agent can be friendly without being trusted. Actions decide for
 * themselves what unverified means.
 */
export async function resolveIdentity(
  claim: IdentityClaim | undefined,
  options: IdentityOptions | undefined,
): Promise<{ contact?: Contact; private?: Record<string, unknown>; rejected: boolean }> {
  // Read whatever the token holds first, so it is available even to a visitor
  // whose user id did not verify: the token carries its own proof.
  const secret = options?.secret
  const claims = secret ? await readClaims(claim?.token, secret) : null
  const carried = claims ? { private: claims } : {}

  if (!claim?.userId) {
    return { contact: claim?.contact, ...carried, rejected: Boolean(options?.required) }
  }

  const base: Contact = { ...claim.contact, id: claim.userId }

  if (!options?.secret) {
    // No secret configured means identity was never meant to be trusted here.
    return { contact: { ...base, verified: false }, ...carried, rejected: false }
  }

  const verified = claim.userHash ? await verifyIdentity(claim.userId, claim.userHash, options.secret) : false

  return { contact: { ...base, verified }, ...carried, rejected: options.required === true && !verified }
}
