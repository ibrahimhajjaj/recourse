import type { Document, Source, SourceContext } from '../types.js'
import { fetchWithRetry } from '../util/http.js'
import { pool } from '../util/pool.js'

export interface NotionSourceOptions {
  /** An internal integration token, shared with the pages you want indexed. */
  token: string
  /**
   * Restrict to these page or database ids. Omit to index everything the
   * integration has been given access to, which is the safer default: Notion
   * grants access per page, so the sharing decision stays in Notion.
   */
  ids?: string[]
  /** Cap on pages fetched. */
  maxPages?: number
  apiBase?: string
  /** Pinned, because Notion changes response shapes between versions. */
  notionVersion?: string
  concurrency?: number
}

interface NotionBlock {
  type?: string
  has_children?: boolean
  id?: string
  [key: string]: unknown
}

interface RichText {
  plain_text?: string
  href?: string | null
  annotations?: { bold?: boolean; italic?: boolean; code?: boolean }
}

/**
 * Notion pages as a knowledge source.
 *
 * A lot of businesses keep their real policies in Notion rather than on a help
 * site, so this is often the only place the true answer exists. Blocks are
 * converted to markdown rather than plain text so headings survive into
 * chunking, which is what keeps a retrieved passage attached to its section.
 */
export function notionSource(options: NotionSourceOptions): Source {
  const base = options.apiBase ?? 'https://api.notion.com/v1'
  const version = options.notionVersion ?? '2022-06-28'
  const maxPages = options.maxPages ?? 50

  async function notion(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const response = await fetchWithRetry(
      `${base}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${options.token}`,
          'Notion-Version': version,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      },
      { signal, attempts: 2 },
    )

    if (!response.ok) throw new Error(`Notion request failed (${response.status})`)
    return (await response.json()) as Record<string, unknown>
  }

  return {
    name: 'notion',

    async load(ctx: SourceContext): Promise<Document[]> {
      const report = ctx.onProgress ?? (() => {})
      report({ phase: 'discover', message: 'listing Notion pages' })

      let pages: Array<{ id: string; title: string; url?: string }> = []

      if (options.ids?.length) {
        pages = options.ids.map((id) => ({ id, title: id }))
      } else {
        const found = (await notion(
          '/search',
          { method: 'POST', body: JSON.stringify({ filter: { property: 'object', value: 'page' }, page_size: 100 }) },
          ctx.signal,
        )) as { results?: Array<Record<string, unknown>> }

        pages = (found.results ?? []).map((page) => ({
          id: String(page.id),
          title: titleOf(page),
          url: typeof page.url === 'string' ? page.url : undefined,
        }))
      }

      pages = pages.slice(0, maxPages)
      report({ phase: 'fetch', message: `reading ${pages.length} pages`, done: 0, total: pages.length })

      let done = 0
      const documents = await pool<(typeof pages)[number], Document | null>(
        pages,
        options.concurrency ?? 3,
        async (page) => {
          try {
            const blocks = (await notion(`/blocks/${page.id}/children?page_size=100`, {}, ctx.signal)) as {
              results?: NotionBlock[]
            }
            const text = toMarkdown(blocks.results ?? [])
            done++
            report({ phase: 'fetch', message: page.title, done, total: pages.length })

            if (text.trim().length < 40) return null
            return { id: `notion:${page.id}`, title: page.title, text, url: page.url }
          } catch (error) {
            // One page the integration cannot read should not stop the rest.
            done++
            report({
              phase: 'fetch',
              message: `skipped ${page.title}: ${error instanceof Error ? error.message : String(error)}`,
              done,
              total: pages.length,
            })
            return null
          }
        },
      )

      return documents.filter((document): document is Document => document !== null)
    },
  }
}

function titleOf(page: Record<string, unknown>): string {
  const properties = page.properties as Record<string, { type?: string; title?: RichText[] }> | undefined
  for (const property of Object.values(properties ?? {})) {
    if (property?.type === 'title' && property.title?.length) {
      return property.title.map((part) => part.plain_text ?? '').join('') || 'Untitled'
    }
  }
  return 'Untitled'
}

/** Converts the block types that actually carry documentation. */
export function toMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = []

  for (const block of blocks) {
    const type = block.type
    if (!type) continue

    const content = block[type] as { rich_text?: RichText[]; language?: string; checked?: boolean } | undefined
    const text = inline(content?.rich_text ?? [])

    switch (type) {
      case 'heading_1':
        lines.push(`# ${text}`)
        break
      case 'heading_2':
        lines.push(`## ${text}`)
        break
      case 'heading_3':
        lines.push(`### ${text}`)
        break
      case 'bulleted_list_item':
        lines.push(`- ${text}`)
        break
      case 'numbered_list_item':
        lines.push(`1. ${text}`)
        break
      case 'to_do':
        lines.push(`- [${content?.checked ? 'x' : ' '}] ${text}`)
        break
      case 'quote':
        lines.push(`> ${text}`)
        break
      case 'code':
        lines.push(`\`\`\`${content?.language ?? ''}\n${text}\n\`\`\``)
        break
      case 'callout':
      case 'toggle':
      case 'paragraph':
        if (text) lines.push(text)
        break
      case 'divider':
        lines.push('---')
        break
      default:
        // Images, embeds and databases have no text worth retrieving on.
        break
    }
  }

  return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

function inline(parts: RichText[]): string {
  return parts
    .map((part) => {
      const raw = part.plain_text ?? ''
      if (!raw) return ''

      // Whitespace has to sit outside the markers: "** bold**" is not bold in
      // any markdown renderer, it is two asterisks and a space.
      const leading = raw.slice(0, raw.length - raw.trimStart().length)
      const trailing = raw.slice(raw.trimEnd().length)
      let text = raw.trim()

      if (!text) return raw

      if (part.annotations?.code) text = `\`${text}\``
      if (part.annotations?.bold) text = `**${text}**`
      if (part.annotations?.italic) text = `*${text}*`
      if (part.href) text = `[${text}](${part.href})`

      return `${leading}${text}${trailing}`
    })
    .join('')
}
