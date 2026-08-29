/**
 * Files a visitor sends along with a question.
 *
 * Support conversations are full of things easier to show than describe: a
 * photo of a damaged item, a PDF invoice, a screenshot of an error. This module
 * owns what is accepted, how it is checked, and how it reaches a model.
 *
 * Two ways to supply one, because they suit different deployments:
 *
 * - `dataUrl` rides inline on the same request and needs no storage anywhere.
 *   Right for a screenshot; wrong for a 40MB scan, since base64 inflates it by
 *   a third and it has to fit in one request body.
 * - `url` points at something you already host. Right when the files are large,
 *   or when they should outlive the turn. Off unless `allowUrls` is set,
 *   because accepting an arbitrary link means asking a provider to fetch it.
 * - `key` names an object this deployment stored itself, through the upload
 *   route in `server/upload.ts`. Right for anything big, and the only one of
 *   the three that survives the request. It arrives with a signature, because
 *   a bare key is a guess away from somebody else's file.
 */

export interface Attachment {
  /** Shown to the agent and kept on the transcript. Never used as a path. */
  name: string
  /** An IANA media type, such as `image/png` or `application/pdf`. */
  mimeType: string
  /** Inline content, as a `data:` URI or a bare base64 string. */
  dataUrl?: string
  /** Somewhere the provider can fetch it instead of receiving it inline. */
  url?: string
  /**
   * An object this deployment stored, from the upload route. Needs `token`:
   * a key on its own is an identifier, and identifiers are guessable.
   */
  key?: string
  /** The signature the upload route issued alongside `key`. */
  token?: string
  /** Decoded size, filled in by validation. */
  bytes?: number
}

export interface AttachmentPolicy {
  /**
   * Media types accepted. Everything else is refused here rather than passed
   * to a model to find out: an allowlist is the only safe shape.
   */
  allow?: string[]
  /** Largest single file, decoded. 10MB by default. */
  maxBytes?: number
  /** Most files on one message. */
  maxCount?: number
  /** Permits `url` attachments. Off by default. */
  allowUrls?: boolean
  /**
   * Permits references to objects this deployment stored. Set by the chat
   * handler when it has somewhere to store them, so a reference is refused
   * outright rather than looked up against nothing.
   */
  allowStored?: boolean
}

export const DEFAULT_ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_COUNT = 4

export interface ValidationResult {
  accepted: Attachment[]
  /** Why each refusal happened, in words worth showing the customer. */
  rejected: Array<{ name: string; reason: string }>
}

/**
 * Checks what arrived before anything else touches it.
 *
 * The widget applies the same limits and this repeats every one of them. The
 * client cap is a courtesy to the visitor, not a control: anything can post to
 * the endpoint.
 */
export function validateAttachments(
  attachments: unknown,
  policy: AttachmentPolicy = {},
): ValidationResult {
  const allow = policy.allow ?? DEFAULT_ALLOWED_TYPES
  const maxBytes = policy.maxBytes ?? DEFAULT_MAX_BYTES
  const maxCount = policy.maxCount ?? DEFAULT_MAX_COUNT

  const accepted: Attachment[] = []
  const rejected: Array<{ name: string; reason: string }> = []

  if (!Array.isArray(attachments)) return { accepted, rejected }

  for (const raw of attachments) {
    const item = (raw ?? {}) as Partial<Attachment>
    const name = sanitiseName(typeof item.name === 'string' ? item.name : 'file')

    if (accepted.length >= maxCount) {
      rejected.push({ name, reason: `no more than ${maxCount} files at a time` })
      continue
    }

    // Media types carry parameters (`text/plain; charset=utf-8`) that are not
    // part of the identity, so compare on the type alone.
    const mimeType =
      typeof item.mimeType === 'string' ? (item.mimeType.split(';')[0] ?? '').trim().toLowerCase() : ''

    if (!mimeType || !allow.includes(mimeType)) {
      rejected.push({ name, reason: `${mimeType || 'that file type'} is not accepted` })
      continue
    }

    // A stored reference carries no content, so there is nothing to measure
    // here. It is checked properly at resolve time, against the object.
    if (typeof item.key === 'string' && item.key) {
      if (!policy.allowStored) {
        rejected.push({ name, reason: 'uploaded files are not accepted here' })
        continue
      }
      if (typeof item.token !== 'string' || !/^[0-9a-f]{64}$/.test(item.token)) {
        rejected.push({ name, reason: 'that file is no longer available' })
        continue
      }
      if (item.key.length > 1024 || item.key.includes('..')) {
        rejected.push({ name, reason: 'that file is no longer available' })
        continue
      }
      accepted.push({ name, mimeType, key: item.key, token: item.token })
      continue
    }

    if (typeof item.url === 'string' && item.url) {
      if (!policy.allowUrls) {
        rejected.push({ name, reason: 'links are not accepted here' })
        continue
      }
      // Any other scheme is a way to make a fetcher read something local, and
      // `file:` or `data:` in a url field is never legitimate.
      let parsed: URL
      try {
        parsed = new URL(item.url)
      } catch {
        rejected.push({ name, reason: 'that is not a valid link' })
        continue
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        rejected.push({ name, reason: 'links must be http or https' })
        continue
      }
      accepted.push({ name, mimeType, url: parsed.href })
      continue
    }

    if (typeof item.dataUrl !== 'string' || !item.dataUrl) {
      rejected.push({ name, reason: 'the file was empty' })
      continue
    }

    const base64 = payloadOf(item.dataUrl)
    const bytes = decodedSize(base64)

    if (bytes <= 0) {
      rejected.push({ name, reason: 'the file was empty' })
      continue
    }
    if (bytes > maxBytes) {
      rejected.push({ name, reason: `files must be under ${describeSize(maxBytes)}` })
      continue
    }
    if (!/^[A-Za-z0-9+/\s]*={0,2}$/.test(base64)) {
      rejected.push({ name, reason: 'the file could not be read' })
      continue
    }

    accepted.push({ name, mimeType, dataUrl: item.dataUrl, bytes })
  }

  return { accepted, rejected }
}

/** The base64 half of a data URI, or the whole string if it is already bare. */
export function payloadOf(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

/**
 * Size from the encoded length rather than by decoding.
 *
 * A 400MB payload should be refused before anything turns it into a buffer,
 * which is exactly what decoding first in order to measure it would do.
 */
export function decodedSize(base64: string): number {
  const clean = base64.replace(/\s/g, '')
  if (clean.length === 0) return 0
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - padding
}

/**
 * A filename is display text, never a path.
 *
 * It reaches the model, the transcript and eventually a help desk screen, so
 * separators and control characters come out here rather than being trusted by
 * everything downstream.
 */
export function sanitiseName(name: string): string {
  return (
    name
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[/\\]/g, '_')
      .replace(/\.{2,}/g, '.')
      .trim()
      .slice(0, 120) || 'file'
  )
}

export function isImage(attachment: Attachment): boolean {
  return attachment.mimeType.startsWith('image/')
}

/** Decodes an inline attachment to bytes, for the text extractors. */
export function toBytes(attachment: Attachment): Uint8Array | null {
  if (!attachment.dataUrl) return null

  try {
    const binary = atob(payloadOf(attachment.dataUrl).replace(/\s/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)}MB` : `${Math.round(bytes / 1024)}KB`
}
