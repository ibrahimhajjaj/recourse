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

/** Extracts the text layer. A scanned PDF has none, and yields nothing. */
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

export const DEFAULT_PARSERS: ParserRegistry = {
  '.pdf': parsePdf,
  '.docx': parseDocx,
}
