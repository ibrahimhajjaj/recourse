/**
 * Turning "I uploaded a file" into "here is the file", safely.
 *
 * Once attachments live in a bucket, a message no longer carries the file. It
 * carries a key. And a key arriving from a browser is not evidence of
 * anything: `attachments/2026-08-29/…-invoice.pdf` is a guessable shape, and
 * somebody else's key is exactly as valid as your own.
 *
 * **So a reference is a capability, not an identifier.** The upload route
 * hands back a key *and* a short signature over it, and nothing here will read
 * an object without one. The alternative, scoping keys by conversation id , 
 * only works if the server issues conversation ids, and in this project the
 * client picks them.
 *
 * The signature is HMAC-SHA256 over the key, on Web Crypto, with the same
 * secret the rest of the deployment already has. It is stateless on purpose:
 * verifying it needs no database round trip, which matters on a Worker where
 * every query counts against a per-invocation budget.
 */

import { safeEqual } from '../util/compare.js'
import type { Attachment } from '../attachments.js'
import { sanitiseName } from '../attachments.js'
import type { Blobs } from './blobs.js'

const encoder = new TextEncoder()

/** What the upload route returns and the chat request sends back. */
export interface StoredReference {
  key: string
  token: string
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Proof that this deployment issued this key. */
export async function signReference(secret: string, key: string): Promise<string> {
  return hmac(secret, key)
}

/** Constant time, so a wrong token does not leak how much of it was right. */
export async function verifyReference(secret: string, key: string, token: string): Promise<boolean> {
  return safeEqual(await hmac(secret, key), token)
}

export interface ResolveOptions {
  blobs: Blobs
  /** The secret the upload route signed keys with. */
  secret: string
  /** Largest stored file that will be loaded. 25MB by default. */
  maxBytes?: number
  /**
   * Sends images to the model as bytes rather than as a signed link.
   *
   * A link is cheaper (the file never passes through this server) but it
   * requires the provider to be able to fetch it, and a self-hosted model on a
   * private network cannot.
   */
  inlineImages?: boolean
}

export const DEFAULT_STORED_MAX_BYTES = 25 * 1024 * 1024

export interface ResolveResult {
  accepted: Attachment[]
  rejected: Array<{ name: string; reason: string }>
}

/**
 * Replaces stored references with something a model can read.
 *
 * Anything without a `key` passes through untouched, so this composes with
 * inline attachments in the same message rather than replacing them.
 *
 * Note what this does *not* do: fetch a customer-supplied `url`. That is still
 * refused, and the distinction is the whole point. An object we stored under a
 * key we minted is ours; a link somebody typed is a request-forgery primitive
 * pointed at our network.
 */
export async function resolveStoredAttachments(
  attachments: Attachment[],
  options: ResolveOptions,
): Promise<ResolveResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_STORED_MAX_BYTES
  const accepted: Attachment[] = []
  const rejected: Array<{ name: string; reason: string }> = []

  for (const attachment of attachments) {
    if (!attachment.key) {
      accepted.push(attachment)
      continue
    }

    const name = sanitiseName(attachment.name)

    if (!attachment.token || !(await verifyReference(options.secret, attachment.key, attachment.token))) {
      // Deliberately the same wording as a missing file. Telling the difference
      // between "not yours" and "not there" is how a key space gets mapped.
      rejected.push({ name, reason: 'that file is no longer available' })
      continue
    }

    let info
    try {
      info = await options.blobs.head(attachment.key)
    } catch (error) {
      rejected.push({
        name,
        reason: error instanceof Error ? error.message : 'the file could not be read',
      })
      continue
    }

    if (!info) {
      rejected.push({ name, reason: 'that file is no longer available' })
      continue
    }

    if (info.size > maxBytes) {
      rejected.push({ name, reason: `files must be under ${Math.round(maxBytes / 1024 / 1024)}MB` })
      continue
    }

    const mimeType = attachment.mimeType || info.mimeType
    const isImage = mimeType.startsWith('image/')

    if (isImage && !options.inlineImages && options.blobs.signedUrl) {
      accepted.push({
        name,
        mimeType,
        url: await options.blobs.signedUrl(attachment.key),
        bytes: info.size,
        key: attachment.key,
      })
      continue
    }

    const content = await options.blobs.get(attachment.key)
    if (!content) {
      rejected.push({ name, reason: 'that file is no longer available' })
      continue
    }

    accepted.push({
      name,
      mimeType,
      dataUrl: `data:${mimeType};base64,${toBase64(content.bytes)}`,
      bytes: content.bytes.byteLength,
      key: attachment.key,
    })
  }

  return { accepted, rejected }
}

/**
 * Base64 in chunks.
 *
 * `String.fromCharCode(...bytes)` on a ten megabyte file spreads ten million
 * arguments across the stack and throws, which is a crash rather than a
 * refusal and shows up only once somebody uploads something big.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}
