import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type { Document, Source } from '../types.js'

export interface FilesSourceOptions {
  /** Directory to walk, or a single file. */
  path: string
  /** Extensions to keep, lowercase and dot-prefixed. */
  extensions?: string[]
  /** Directory names skipped anywhere in the tree. */
  ignore?: string[]
}

const DEFAULT_EXTENSIONS = ['.md', '.mdx', '.txt', '.markdown']
const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage']

/**
 * Reads local documentation. Useful when the content already lives in the repo
 * and there is nothing to crawl, and it spends no Firecrawl credits at all.
 */
export function filesSource(options: FilesSourceOptions): Source {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS)
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORE)

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
        const text = await readFile(file, 'utf8')
        if (text.trim().length < 40) continue
        const id = relative(root, file) || file
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
