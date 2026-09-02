/**
 * Readers for the document formats a business actually has its policies in.
 *
 * These import their parser only when a matching file turns up, and the parsers
 * are optional peers rather than dependencies. Most people ingest a website and
 * should not download a PDF engine to do it; the few who need one get a clear
 * instruction instead of a stack trace.
 */

export type DocumentParser = (data: Uint8Array) => Promise<string>

export interface ParserRegistry {
  [extension: string]: DocumentParser
}

/**
 * Imports a parser package that may not be there.
 *
 * Exported because `ParserRegistry` is a documented extension point: anyone
 * adding a reader for a format we do not ship should fail the same way, with
 * the same distinction between absent and broken.
 */
export async function loadParser<T>(specifier: string, install: string): Promise<T>
export async function loadParser<T>(load: () => Promise<T>, install?: string): Promise<T>
export async function loadParser<T>(
  source: string | (() => Promise<T>),
  install = '',
): Promise<T> {
  const specifier = typeof source === 'string' ? source : 'the parser'
  try {
    return typeof source === 'string'
      ? ((await import(/* @vite-ignore */ source)) as T)
      : await source()
  } catch (error) {
    // Only a genuinely absent package should be answered with "install it".
    // A parser that is installed but will not load on this runtime is a
    // different problem, and sending someone to reinstall it wastes their day.
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        `reading this file needs the optional "${specifier}" package. Install it with: ${install}`,
      )
    }
    throw new Error(
      `the "${specifier}" package is installed but failed to load: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Extracts the text layer.
 *
 * A scanned PDF is a stack of photographs with no text layer at all, and the
 * only honest thing to return for one is nothing. Saying so out loud is the
 * point: a business that points this at two hundred pages of scanned policy
 * gets an index with nothing in it, an agent that cannot answer anything, and
 * no indication that the file was the problem rather than the agent.
 *
 * Reading it properly needs OCR, which is a different kind of dependency and a
 * decision for whoever owns the documents. Naming the file is what lets them
 * make it.
 */
export const parsePdf: DocumentParser = async (data) => {
  const pdfjs = await loadParser<{
    getDocument(source: { data: Uint8Array; useSystemFonts?: boolean }): { promise: Promise<PdfDocument> }
  }>('pdfjs-dist/legacy/build/pdf.mjs', 'npm install pdfjs-dist')

  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  const pages: string[] = []

  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    // Page breaks become paragraph breaks so the chunker has somewhere to split.
    if (text) pages.push(text)
  }

  // Every page empty on a document that has pages. A partly scanned file still
  // indexes what it can, so only the total absence is worth saying anything
  // about; a warning on every mixed document would be noise nobody reads.
  if (pdf.numPages > 0 && pages.length === 0) {
    console.warn(
      '[recourse] a PDF produced no text at all. It is almost certainly scanned images rather ' +
        'than text, and nothing from it has been indexed. Reading it needs OCR.',
    )
  }

  return pages.join('\n\n')
}

interface PdfDocument {
  numPages: number
  getPage(number: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string }> }> }>
}

/** Word documents, converted to markdown so headings survive into chunking. */
export const parseDocx: DocumentParser = async (data) => {
  const mammoth = await loadParser<{
    convertToMarkdown(input: { buffer: Buffer }): Promise<{ value: string }>
  }>('mammoth', 'npm install mammoth')

  const result = await mammoth.convertToMarkdown({ buffer: Buffer.from(data) })
  return result.value
}

/**
 * The formats a business keeps things in that are not documents.
 *
 * A price list is a spreadsheet, an onboarding pack is a slide deck, and a
 * handbook exported from anywhere but Word is one of the OpenDocument formats.
 * None of them are readable by the two parsers above, and until now a folder
 * full of them indexed as an empty knowledge base.
 *
 * One parser covers all of them, so it is registered once against each
 * extension it handles. It is a compiled binary rather than JavaScript, which
 * is why it stays optional and why PDFs and Word documents are left with the
 * readers they already had: those run anywhere, and a knowledge base should not
 * need a platform-specific download to read a `.docx`.
 */
const CONVERTED: Record<string, string> = {
  '.pptx': 'pptx',
  '.ppt': 'ppt',
  '.xlsx': 'xlsx',
  '.ods': 'ods',
  '.odp': 'odp',
  '.odt': 'odt',
  '.doc': 'doc',
  '.rtf': 'rtf',
  '.epub': 'epub',
  '.csv': 'csv',
}

/**
 * Reads one of the above into markdown.
 *
 * The format is named rather than sniffed. Detection reads the file signature,
 * which several of these do not have: a CSV is just text, and guessing wrong on
 * one turns a price list into nothing.
 */
export function parseConverted(format: string): DocumentParser {
  return async (data) => {
    const anydoc = await loadParser<{
      toMarkdownBytes(bytes: Uint8Array, format?: string | null): Promise<string>
    }>('@firecrawl/anydoc', 'npm install @firecrawl/anydoc')

    return anydoc.toMarkdownBytes(data, format)
  }
}

export const DEFAULT_PARSERS: ParserRegistry = {
  '.pdf': parsePdf,
  '.docx': parseDocx,
  ...Object.fromEntries(
    Object.entries(CONVERTED).map(([extension, format]) => [extension, parseConverted(format)]),
  ),
}
