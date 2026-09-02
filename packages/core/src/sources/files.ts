import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type { Document, Source } from '../types.js'
import { DEFAULT_PARSERS, type ParserRegistry } from './documents.js'

export interface FilesSourceOptions {
  /** Directory to walk, or a single file. */
  path: string
  /** Extensions to keep, lowercase and dot-prefixed. */
  extensions?: string[]
  /** Directory names skipped anywhere in the tree. */
  ignore?: string[]
  /**
   * Readers for binary formats, by extension. PDF and DOCX are handled out of
   * the box once their optional parser packages are installed.
   */
  parsers?: ParserRegistry
  /** Files larger than this are skipped. 20MB by default. */
  maxBytes?: number
}

/**
 * What a folder of documentation is scanned for unless told otherwise.
 *
 * `.csv` is deliberately absent while still being readable. A folder almost
 * always has a CSV in it that is data rather than documentation, and quietly
 * indexing an export of every customer is a surprise nobody asked for. Name it
 * in `extensions` and it is read.
 */
const DEFAULT_EXTENSIONS = [
  '.md',
  '.mdx',
  '.txt',
  '.markdown',
  '.pdf',
  '.docx',
  '.doc',
  '.odt',
  '.rtf',
  '.epub',
  '.pptx',
  '.ppt',
  '.odp',
  '.xlsx',
  '.ods',
]
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage']

/**
 * Reads local documentation. Useful when the content already lives in the repo
 * and there is nothing to crawl, and it spends no Firecrawl credits at all.
 */
export function filesSource(options: FilesSourceOptions): Source {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS)
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORE)
  const parsers = { ...DEFAULT_PARSERS, ...options.parsers }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  return {
    name: 'files',
    async load(ctx): Promise<Document[]> {
      const report = ctx.onProgress ?? (() => {})
      const root = options.path
      const entries = (await stat(root)).isDirectory() ? await walk(root, ignore) : [root]
      const wanted = entries.filter((file) => extensions.has(extname(file).toLowerCase()))

      report({ phase: 'fetch', message: `reading ${wanted.length} files`, done: 0, total: wanted.length })

      const documents: Document[] = []

      for (const file of wanted) {
        const id = relative(root, file) || file
        const info = await stat(file)

        if (info.size > maxBytes) {
          report({ phase: 'fetch', message: `skipped ${id}, larger than ${maxBytes} bytes` })
          continue
        }

        const extension = extname(file).toLowerCase()
        const parser = parsers[extension]

        let text: string
        try {
          text = parser ? await parser(new Uint8Array(await readFile(file))) : await readFile(file, 'utf8')
        } catch (error) {
          // One unreadable file should not abandon the whole ingest.
          report({
            phase: 'fetch',
            message: `skipped ${id}: ${error instanceof Error ? error.message : String(error)}`,
          })
          continue
        }

        if (text.trim().length < 40) continue
        documents.push({ id, title: titleOf(text, id), text })
        report({ phase: 'fetch', message: id, done: documents.length, total: wanted.length })
      }

      return documents
    },
  }
}

async function walk(dir: string, ignore: Set<string>): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ignore.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full, ignore)))
    else out.push(full)
  }
  return out
}

/** Prefers the document's own H1 over a filename guess. */
function titleOf(text: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(text)
  if (heading) return (heading[1] as string).trim()
  const name = fallback.split(sep).pop() ?? fallback
  return name.replace(extname(name), '').replace(/[-_]/g, ' ')
}
