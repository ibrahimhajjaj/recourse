import type { Chunk, Chunker, Document } from '../types.js'

export interface MarkdownChunkerOptions {
  /** Upper bound on a chunk, in characters. Roughly 300 tokens at the default. */
  maxChars?: number
  /** Chunks shorter than this get folded into their neighbour instead of standing alone. */
  minChars?: number
  /** Characters of the previous chunk repeated at the start of the next one. */
  overlap?: number
}

const DEFAULTS = { maxChars: 1200, minChars: 120, overlap: 150 } as const

/** A line that is nothing but a link, which is what scraped nav and footers look like. */
const LINK_ONLY = /^\s*[-*]?\s*\[[^\]]*\]\([^)]*\)\s*$/

/**
 * Documentation generators love hanging an anchor link inside the heading
 * itself, so a scraped `## Refunds` arrives as `## [\u200b](/page#refunds) Refunds`.
 * Left alone that URL becomes part of the citation shown to the customer and
 * part of the keyword index, where it matches nothing anyone would ever type.
 */
function cleanHeading(raw: string): string {
  return raw
    // Keep a real link's text, drop its target.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#]/g, '')
    // Zero-width and non-breaking characters are what anchor links are made of.
    .replace(/[\u200b-\u200d\ufeff\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Splits on headings first, then packs the resulting sections up to a size
 * budget. Heading boundaries are where authors already decided one idea stops
 * and the next begins, so respecting them beats splitting on a fixed window:
 * a retrieved chunk arrives as a complete thought rather than half of two.
 */
export function markdownChunker(options: MarkdownChunkerOptions = {}): Chunker {
  const maxChars = options.maxChars ?? DEFAULTS.maxChars
  const minChars = options.minChars ?? DEFAULTS.minChars
  const overlap = options.overlap ?? DEFAULTS.overlap

  return {
    name: 'markdown',
    split(doc: Document): Chunk[] {
      const sections = toSections(stripNavigation(doc.text))
      const chunks: Chunk[] = []
      let ordinal = 0

      for (const section of sections) {
        for (const body of packSection(section.body, maxChars, overlap)) {
          const text = body.trim()
          if (text.length === 0) continue

          const previous = chunks[chunks.length - 1]
          // A stray fragment on its own retrieves badly; glue it to the last chunk.
          if (text.length < minChars && previous && previous.section === section.heading) {
            previous.text = `${previous.text}\n\n${text}`
            continue
          }

          chunks.push({
            id: `${doc.id}#${ordinal++}`,
            docId: doc.id,
            title: doc.title,
            section: section.heading || undefined,
            text,
            url: doc.url,
            meta: doc.meta,
          })
        }
      }

      return chunks
    },
  }
}

interface Section {
  heading: string
  body: string
}

/**
 * Scraped pages carry menus, breadcrumbs and footers on every single page. Left
 * in, they become the most common text in the corpus and poison both the
 * keyword statistics and the model's context window.
 */
function stripNavigation(text: string): string {
  const lines = text.split('\n')
  const kept: string[] = []
  let run = 0

  for (const line of lines) {
    if (LINK_ONLY.test(line)) {
      run++
      // One or two links in a row is prose. Four is a navigation block.
      if (run >= 4) continue
    } else {
      run = 0
    }
    kept.push(line)
  }

  return kept.join('\n')
}

function toSections(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []
  /** Heading text by depth, so a nested heading can render its full trail. */
  const trail: string[] = []
  let heading = ''
  let body: string[] = []
  let inFence = false

  let depth = 0
  /** Whether the current heading has already reached a section. */
  let carried = false

  /**
   * Ends the current section.
   *
   * `next` is the depth of the heading about to start, or 0 at the end of the
   * document. A heading with no body of its own is normally fine, because a
   * heading nested under it carries it in the trail. When nothing nests under
   * it, that heading is the only place its words appear, and dropping the
   * section drops them: a contact page whose number is the heading becomes a
   * page with no number in it. So an orphaned heading becomes its own section.
   */
  const flush = (next: number) => {
    const joined = body.join('\n').trim()

    if (joined.length > 0) {
      sections.push({ heading, body: joined })
      carried = true
    } else if (heading && !carried && next <= depth) {
      sections.push({ heading, body: trail[depth - 1] ?? heading })
    }

    body = []
  }

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence

    const match = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line)
    if (match) {
      const at = (match[1] as string).length
      flush(at)
      if (at <= depth) carried = false
      depth = at
      trail.length = at - 1
      trail[at - 1] = cleanHeading(match[2] as string)
      heading = trail.filter(Boolean).join(' > ')
      continue
    }

    body.push(line)
  }

  flush(0)
  return sections
}

/** Greedily fills chunks paragraph by paragraph, never cutting mid-paragraph. */
function packSection(body: string, maxChars: number, overlap: number): string[] {
  if (body.length <= maxChars) return [body]

  const paragraphs = body.split(/\n{2,}/)
  const out: string[] = []
  let current = ''

  const push = () => {
    if (current.trim().length === 0) return
    out.push(current.trim())
    // Carry the tail forward so a sentence spanning the seam is still findable.
    current = overlap > 0 ? `${current.slice(-overlap)}\n\n` : ''
  }

  for (const paragraph of paragraphs) {
    // A single paragraph over budget (a long table or code block) is split hard.
    if (paragraph.length > maxChars) {
      push()
      for (let i = 0; i < paragraph.length; i += maxChars) {
        out.push(paragraph.slice(i, i + maxChars).trim())
      }
      current = ''
      continue
    }

    if (current.length + paragraph.length > maxChars) push()
    current += `${paragraph}\n\n`
  }

  push()
  return out.filter((chunk) => chunk.trim().length > 0)
}
