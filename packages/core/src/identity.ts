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
): Promise<{ contact?: Contact; rejected: boolean }> {
  if (!claim?.userId) {
    return { contact: claim?.contact, rejected: Boolean(options?.required) }
  }

  const base: Contact = { ...claim.contact, id: claim.userId }

  if (!options?.secret) {
    // No secret configured means identity was never meant to be trusted here.
    return { contact: { ...base, verified: false }, rejected: false }
  }

  const verified = claim.userHash ? await verifyIdentity(claim.userId, claim.userHash, options.secret) : false
  return { contact: { ...base, verified }, rejected: options.required === true && !verified }
}
