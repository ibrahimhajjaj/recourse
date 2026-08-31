import type { Document, Source, SourceContext } from '../types.js'
import { pool } from '../util/pool.js'
import { fetchWithRetry } from '../util/http.js'
import { scrape } from './firecrawl.js'

export interface WebsiteSourceOptions {
  /** The site to learn. Any page on it will do; discovery starts from the origin. */
  url: string
  /** Hard ceiling on pages fetched, which is also the ceiling on credits spent. */
  maxPages?: number
  /** Only keep URLs whose path contains one of these. */
  include?: string[]
  /** Drop URLs whose path contains one of these. */
  exclude?: string[]
  /** Raises rate limits. Everything works without one. */
  apiKey?: string
  /** Parallel page fetches. Kept low so the free tier is not tripped. */
  concurrency?: number
}

const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|zip|gz|mp4|webm|woff2?|ttf|eot)(\?|$)/i
const DEFAULT_EXCLUDE = ['/cdn-cgi/', '/wp-admin/', '/wp-json/', '/tag/', '/author/', '/feed']

/**
 * Turns a website into documents. Discovery runs cheapest-first: a sitemap is
 * a plain GET and costs nothing, llms.txt is the same, and only when a site
 * offers neither does it fall back to spending a credit per page to follow
 * links. On a typical documentation site the sitemap path means the whole
 * corpus is discovered for free and credits go entirely on content.
 */
export function websiteSource(options: WebsiteSourceOptions): Source {
  const origin = new URL(options.url).origin
  const maxPages = options.maxPages ?? 50
  const concurrency = options.concurrency ?? (options.apiKey ? 8 : 3)

  return {
    name: 'website',
    async load(ctx: SourceContext): Promise<Document[]> {
      const report = ctx.onProgress ?? (() => {})

      report({ phase: 'discover', message: `looking for a sitemap on ${origin}` })
      let urls = await discoverFromSitemap(origin, ctx.signal)

      if (urls.length === 0) {
        report({ phase: 'discover', message: 'no sitemap, checking llms.txt' })
        urls = await discoverFromLlmsTxt(origin, ctx.signal)
      }

      let seeded: Document[] = []
      if (urls.length === 0) {
        report({ phase: 'discover', message: 'no sitemap, following links from the homepage' })
        const crawled = await discoverByCrawling(options.url, origin, maxPages, options, ctx)
        seeded = crawled.documents
        urls = crawled.urls
      }

      const filtered = filterUrls(urls, origin, options).slice(0, maxPages)
      const alreadyHave = new Set(seeded.map((doc) => doc.id))
      const remaining = filtered.filter((url) => !alreadyHave.has(url))

      report({ phase: 'fetch', message: `reading ${remaining.length} pages`, done: 0, total: remaining.length })

      let done = 0
      const fetched = await pool<string, Document | null>(remaining, concurrency, async (url) => {
        const page = await scrape(url, ['markdown'], { apiKey: options.apiKey, signal: ctx.signal })
        done++
        report({ phase: 'fetch', message: url, done, total: remaining.length })
        if (!page || page.markdown.trim().length < 80) return null
        return { id: url, title: page.title, text: page.markdown, url }
      })

      return [...seeded, ...fetched.filter((doc): doc is Document => doc !== null)]
    },
  }
}

/** Follows <sitemapindex> one level deep, which covers essentially every real site. */
async function discoverFromSitemap(origin: string, signal?: AbortSignal): Promise<string[]> {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`]

  for (const candidate of candidates) {
    const xml = await getText(candidate, signal)
    if (!xml) continue

    const nested = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/sitemap>/g)].map(
      (match) => match[1] as string,
    )

    if (nested.length > 0) {
      const pages: string[] = []
      // A handful of child sitemaps is plenty; huge sites get capped later anyway.
      for (const child of nested.slice(0, 5)) {
        const childXml = await getText(child, signal)
        if (childXml) pages.push(...extractLocs(childXml))
      }
      if (pages.length > 0) return pages
    }

    const locs = extractLocs(xml)
    if (locs.length > 0) return locs
  }

  return []
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((match) => match[1] as string)
    .filter((url) => !url.endsWith('.xml'))
}

/** llms.txt is a curated markdown list of a site's own best pages. */
async function discoverFromLlmsTxt(origin: string, signal?: AbortSignal): Promise<string[]> {
  const text = await getText(`${origin}/llms.txt`, signal)
  if (!text) return []
  return [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1] as string)
}

/**
 * Last resort: breadth-first over links. Each page is scraped for markdown and
 * links together, so following the graph costs nothing beyond the content that
 * was going to be fetched anyway.
 */
async function discoverByCrawling(
  start: string,
  origin: string,
  maxPages: number,
  options: WebsiteSourceOptions,
  ctx: SourceContext,
): Promise<{ urls: string[]; documents: Document[] }> {
  const report = ctx.onProgress ?? (() => {})
  const seen = new Set<string>([normalize(start)])
  const queue = [start]
  const documents: Document[] = []

  while (queue.length > 0 && documents.length < maxPages) {
    const batch = queue.splice(0, options.concurrency ?? 3)

    const pages = await pool(batch, batch.length, async (url) => {
      const page = await scrape(url, ['markdown', 'links'], { apiKey: options.apiKey, signal: ctx.signal })
      return { url, page }
    })

    for (const { url, page } of pages) {
      if (!page) continue

      if (page.markdown.trim().length >= 80) {
        documents.push({ id: url, title: page.title, text: page.markdown, url })
        report({ phase: 'fetch', message: url, done: documents.length, total: maxPages })
      }

      for (const link of filterUrls(page.links, origin, options)) {
        const key = normalize(link)
        if (seen.has(key)) continue
        seen.add(key)
        queue.push(link)
      }
    }
  }

  return { urls: documents.map((doc) => doc.id), documents }
}

function filterUrls(urls: string[], origin: string, options: WebsiteSourceOptions): string[] {
  const exclude = [...DEFAULT_EXCLUDE, ...(options.exclude ?? [])]
  const out = new Map<string, string>()

  for (const raw of urls) {
    let url: URL
    try {
      url = new URL(raw, origin)
    } catch {
      continue
    }

    if (url.origin !== origin) continue
    if (ASSET.test(url.pathname)) continue
    if (exclude.some((pattern) => url.pathname.includes(pattern))) continue
    if (options.include?.length && !options.include.some((pattern) => url.pathname.includes(pattern))) continue

    const key = normalize(url.href)
    if (!out.has(key)) out.set(key, `${url.origin}${url.pathname}${url.search}`)
  }

  return [...out.values()]
}

/** Fragments and trailing slashes are the same page; treat them as one. */
function normalize(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.origin}${path}${parsed.search}`
  } catch {
    return url
  }
}

async function getText(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetchWithRetry(url, { headers: { 'User-Agent': 'recourse' } }, { attempts: 2, signal })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}
