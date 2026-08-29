/**
 * Turning checked attachments into something a model can actually read.
 *
 * Images go to the provider as file parts, because that is the only way a
 * vision model sees them. Everything else is extracted to text here and put in
 * the prompt: no widely available model takes a raw .docx, and a PDF sent as
 * bytes costs far more tokens than its text layer does.
 */

import type { Attachment } from './attachments.js'
import { isImage, toBytes } from './attachments.js'
import type { DocumentParser } from './sources/documents.js'
import { DEFAULT_PARSERS } from './sources/documents.js'

/** A multimodal content part, in the shape the AI SDK expects. */
export interface FilePart {
  type: 'file'
  mediaType: string
  data: string
  filename?: string
}

export interface PreparedAttachments {
  /** Sent alongside the question as multimodal parts. Images only. */
  parts: FilePart[]
  /**
   * Text pulled out of documents, and notes about anything unreadable. Goes in
   * the prompt so the agent knows what it was given either way.
   */
  context: string
  /** What could not be read, for logging and for telling the customer. */
  failures: Array<{ name: string; reason: string }>
}

export interface PrepareOptions {
  /**
   * Whether the model can see images. When false they are named in the prompt
   * rather than sent, so a text-only model says "I cannot open that photo"
   * instead of the provider rejecting the whole request.
   */
  vision?: boolean
  /**
   * Readers by media type, merged over the built-in PDF and Word ones. Add a
   * spreadsheet or an email format here without touching this module.
   */
  extractors?: Record<string, DocumentParser>
  /** Characters kept from any single document. */
  maxTextChars?: number
}

const DEFAULT_MAX_TEXT_CHARS = 20_000

/** Media types whose bytes are already text, needing no parser at all. */
const PLAIN_TEXT = /^text\//

const BUILT_IN_EXTRACTORS: Record<string, DocumentParser> = {
  'application/pdf': DEFAULT_PARSERS['.pdf'] as DocumentParser,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': DEFAULT_PARSERS[
    '.docx'
  ] as DocumentParser,
}

export async function prepareAttachments(
  attachments: Attachment[],
  options: PrepareOptions = {},
): Promise<PreparedAttachments> {
  const vision = options.vision ?? true
  const extractors = { ...BUILT_IN_EXTRACTORS, ...options.extractors }
  const maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS

  const parts: FilePart[] = []
  const blocks: string[] = []
  const failures: Array<{ name: string; reason: string }> = []

  for (const attachment of attachments) {
    if (isImage(attachment)) {
      if (!vision) {
        blocks.push(`The customer attached an image named "${attachment.name}". You cannot see it.`)
        continue
      }
      const data = attachment.url ?? attachment.dataUrl
      if (!data) {
        failures.push({ name: attachment.name, reason: 'the image had no content' })
        continue
      }
      parts.push({ type: 'file', mediaType: attachment.mimeType, data, filename: attachment.name })
      continue
    }

    // A hosted document would have to be downloaded before it could be parsed,
    // and fetching a customer-supplied URL server-side is a request forgery
    // waiting to happen. Name it and let the agent ask.
    if (attachment.url) {
      blocks.push(`The customer linked a file named "${attachment.name}" at ${attachment.url}.`)
      continue
    }

    const bytes = toBytes(attachment)
    if (!bytes) {
      failures.push({ name: attachment.name, reason: 'the file could not be decoded' })
      continue
    }

    let text: string
    try {
      if (PLAIN_TEXT.test(attachment.mimeType)) {
        text = new TextDecoder().decode(bytes)
      } else {
        const extractor = extractors[attachment.mimeType]
        if (!extractor) {
          failures.push({ name: attachment.name, reason: `${attachment.mimeType} cannot be read` })
          continue
        }
        text = await extractor(bytes)
      }
    } catch (error) {
      // A missing optional parser package lands here with a useful message, and
      // so does a corrupt file. Either way one bad file must not fail the turn.
      failures.push({
        name: attachment.name,
        reason: error instanceof Error ? error.message : 'the file could not be read',
      })
      continue
    }

    const trimmed = text.trim()
    if (!trimmed) {
      // Overwhelmingly this is a scan: a PDF of photographed pages has no text
      // layer, and saying so is more useful than an empty context block.
      failures.push({
        name: attachment.name,
        reason: 'no readable text, which usually means it is a scan or an image-only PDF',
      })
      continue
    }

    blocks.push(
      `File the customer attached: "${attachment.name}"\n${trimmed.slice(0, maxTextChars)}`,
    )
  }

  // Failures stay out of the content blocks on purpose. They are rendered as
  // their own section with a hard rule attached, because a model told "this
  // could not be read" in passing will cheerfully answer about it anyway.
  return { parts, context: blocks.join('\n\n'), failures }
}
