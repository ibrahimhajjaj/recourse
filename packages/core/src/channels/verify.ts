/**
 * Webhook signature verification.
 *
 * A channel endpoint is a public URL that makes your agent answer, which means
 * an unverified one lets anyone on the internet spend your model budget and
 * put words in your brand's mouth. Every adapter here refuses unsigned traffic
 * by default.
 *
 * All three schemes are implemented on Web Crypto rather than node:crypto, so
 * the same code runs on Workers, Deno and Bun as well as Node.
 */

import { safeEqual } from '../util/compare.js'

// Re-exported so the channels keep their existing entry point for it, and so
// anything already importing it from here does not have to move.
export { safeEqual }

const encoder = new TextEncoder()

type HashName = 'SHA-1' | 'SHA-256'

async function hmac(secret: string, message: string, hash: HashName): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash }, false, [
    'sign',
  ])
  return crypto.subtle.sign('HMAC', key, encoder.encode(message))
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}


/**
 * Meta's scheme, used by WhatsApp, Messenger and Instagram.
 * `X-Hub-Signature-256: sha256=<hex of HMAC-SHA256(appSecret, rawBody)>`
 */
export async function verifyMeta(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false
  const expected = toHex(await hmac(appSecret, rawBody, 'SHA-256'))
  return safeEqual(expected, header.slice('sha256='.length).toLowerCase())
}

export interface SlackVerification {
  signature: string | null
  timestamp: string | null
  rawBody: string
  signingSecret: string
  /** Replay window in seconds. Slack's own guidance is five minutes. */
  toleranceSeconds?: number
  now?: number
}

/**
 * Slack signs `v0:{timestamp}:{body}`, and the timestamp is what stops a
 * captured request being replayed at leisure, so it is checked first.
 */
export async function verifySlack(options: SlackVerification): Promise<boolean> {
  const { signature, timestamp, rawBody, signingSecret } = options
  if (!signature?.startsWith('v0=') || !timestamp) return false

  const sent = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(sent)) return false

  const now = options.now ?? Math.floor(Date.now() / 1000)
  const tolerance = options.toleranceSeconds ?? 300
  if (Math.abs(now - sent) > tolerance) return false

  const expected = `v0=${toHex(await hmac(signingSecret, `v0:${timestamp}:${rawBody}`, 'SHA-256'))}`
  return safeEqual(expected, signature)
}

export interface TwilioVerification {
  signature: string | null
  /** The exact URL Twilio called, including query string. */
  url: string
  /** Form fields for a form-encoded post; empty for a JSON body. */
  params?: Record<string, string>
  authToken: string
}

/**
 * Twilio signs the URL with every POST field appended, sorted by name and
 * concatenated with no delimiter, then HMAC-SHA1 and base64.
 *
 * The sort is byte order rather than locale order: `Caller` must come before
 * `Digits`, and a locale-aware comparison would not guarantee that.
 */
export async function verifyTwilio(options: TwilioVerification): Promise<boolean> {
  if (!options.signature) return false

  const params = options.params ?? {}
  const sorted = Object.keys(params).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const payload = sorted.reduce((accumulated, key) => accumulated + key + params[key], options.url)

  const expected = toBase64(await hmac(options.authToken, payload, 'SHA-1'))
  return safeEqual(expected, options.signature)
}

/** Signing helpers, so tests and outbound calls can produce real signatures. */
export async function signMeta(rawBody: string, appSecret: string): Promise<string> {
  return `sha256=${toHex(await hmac(appSecret, rawBody, 'SHA-256'))}`
}

export async function signSlack(rawBody: string, timestamp: string, signingSecret: string): Promise<string> {
  return `v0=${toHex(await hmac(signingSecret, `v0:${timestamp}:${rawBody}`, 'SHA-256'))}`
}

export async function signTwilio(
  url: string,
  params: Record<string, string>,
  authToken: string,
): Promise<string> {
  const sorted = Object.keys(params).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const payload = sorted.reduce((accumulated, key) => accumulated + key + params[key], url)
  return toBase64(await hmac(authToken, payload, 'SHA-1'))
}
