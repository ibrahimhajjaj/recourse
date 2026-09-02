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
/**
 * Paths that are never documentation, whatever site they are on.
 *
 * Kept short deliberately. Matching is a substring test, so a broader list
 * costs real pages: `/login` would drop a help page about login problems, and a
 * question nobody can answer is a worse outcome than a page nobody needed. The
 * rest is a decision about a particular site, which is what `planCrawl` and
 * `exclude` are for.
 */
const DEFAULT_EXCLUDE = [
  '/cdn-cgi/',
  '/wp-admin/',
  '/wp-json/',
  '/wp-login.php',
  '/tag/',
  '/author/',
  '/feed',
]

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
      const listed = await discoverFromSitemap(origin, ctx.signal)

      // Kept whether or not anything uses it: a site that publishes dates is
      // telling us which of its pages are worth paying to read again.
      const changedAt = new Map(
        listed.filter((entry) => entry.lastmod).map((entry) => [entry.url, entry.lastmod as string]),
      )

      let urls = listed.map((entry) => entry.url)

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
      let skipped = 0

      const fetched = await pool<string, Document | null>(remaining, concurrency, async (url) => {
        const lastmod = changedAt.get(url)

        // The site says this page has not changed since the build that is being
        // replaced, so it is not read at all. Reading it costs a page scrape,
        // and the answer is already in the index.
        if (lastmod && ctx.validatorFor?.(url)?.lastModified === lastmod) {
          ctx.report?.(url, { unchanged: true, validator: { lastModified: lastmod } })
          done++
          skipped++
          report({ phase: 'fetch', message: `${url} is unchanged`, done, total: remaining.length })

          return null
        }

        const page = await scrape(url, ['markdown'], { apiKey: options.apiKey, signal: ctx.signal })
        done++
        report({ phase: 'fetch', message: url, done, total: remaining.length })
        if (!page || page.markdown.trim().length < 80) return null

        // Recorded after the page was read, so a scrape that failed leaves the
        // old date in place and the page is tried again next time. Recording it
        // first would mark a page we never read as up to date.
        ctx.report?.(url, lastmod ? { validator: { lastModified: lastmod } } : {})

        return { id: url, title: page.title, text: page.markdown, url }
      })

      if (skipped > 0) {
        report({ phase: 'fetch', message: `${skipped} of ${remaining.length} pages were unchanged and were not read` })
      }

      return [...seeded, ...fetched.filter((doc): doc is Document => doc !== null)]
    },
  }
}

/** A page a sitemap listed, and when the site says it last changed. */
interface Listed {
  url: string
  /** The `<lastmod>` exactly as written, compared as an opaque string. */
  lastmod?: string
}

/** Follows <sitemapindex> one level deep, which covers essentially every real site. */
async function discoverFromSitemap(origin: string, signal?: AbortSignal): Promise<Listed[]> {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`]

  for (const candidate of candidates) {
    const xml = await getText(candidate, signal)
    if (!xml) continue

    const nested = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/sitemap>/g)].map(
      (match) => match[1] as string,
    )

    if (nested.length > 0) {
      const pages: Listed[] = []
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

/**
 * The pages a sitemap lists, each with its `<lastmod>` when it has one.
 *
 * Read per `<url>` block rather than by collecting every tag in the document,
 * because a date has to belong to the page above it. Pairing the nth lastmod
 * with the nth loc breaks the moment one entry omits it, and the failure is
 * silent: pages get stamped with a neighbour's date and stop being re-read.
 *
 * A sitemap with no `<url>` blocks at all still yields its locations, so an
 * unusually shaped one is crawled exactly as it was before.
 */
function extractLocs(xml: string): Listed[] {
  const entries = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/g)]

  const listed = entries.flatMap((entry) => {
    const block = entry[1] as string
    const url = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(block)?.[1]
    if (!url) return []

    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(block)?.[1]

    return [lastmod ? { url, lastmod } : { url }]
  })

  if (listed.length > 0) return listed.filter((entry) => !entry.url.endsWith('.xml'))

  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((match) => ({ url: match[1] as string }))
    .filter((entry) => !entry.url.endsWith('.xml'))
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

/** A page a crawl would read, and where it was found. */
export interface PlannedPage {
  url: string
  /** When the site says it last changed, when it says. */
  lastmod?: string
}

export interface CrawlPlan {
  /** How the pages were found, which is what a surprising result usually is. */
  discovered: 'sitemap' | 'llms.txt' | 'links'
  /** The pages that would be read, in order, already capped at `maxPages`. */
  pages: PlannedPage[]
  /** Found and then filtered out, with the rule that did it. */
  skipped: Array<{ url: string; because: string }>
  /** Found, allowed, and over the `maxPages` ceiling. */
  overflow: number
}

/**
 * What a crawl would read, without reading it.
 *
 * A knowledge base is only as good as what went into it, and the usual problem
 * is not a page that failed but a page that succeeded and should not have: a
 * login screen, a privacy policy, a decade of press releases. Those are only
 * visible afterwards, as an agent answering questions nobody asked, and by then
 * the crawl has been paid for.
 *
 * This does the discovery and the filtering and stops. It reads the sitemap,
 * which is one request, and nothing else: no page is fetched, so nothing is
 * charged for. Run it, look at the list, add what you did not want to
 * `exclude`, and run it again.
 */
export async function planCrawl(
  options: WebsiteSourceOptions,
  ctx: SourceContext = {},
): Promise<CrawlPlan> {
  const origin = new URL(options.url).origin
  const maxPages = options.maxPages ?? 50

  const listed = await discoverFromSitemap(origin, ctx.signal)
  let discovered: CrawlPlan['discovered'] = 'sitemap'
  let urls = listed.map((entry) => entry.url)

  if (urls.length === 0) {
    urls = await discoverFromLlmsTxt(origin, ctx.signal)
    discovered = 'llms.txt'
  }

  // Following links means fetching pages to find their links, which is the one
  // thing this promises not to do. Said plainly rather than silently returning
  // an empty plan, which would read as "this site has no pages".
  if (urls.length === 0) {
    return { discovered: 'links', pages: [], skipped: [], overflow: 0 }
  }

  const changedAt = new Map(
    listed.filter((entry) => entry.lastmod).map((entry) => [entry.url, entry.lastmod as string]),
  )

  const allowed = filterUrls(urls, origin, options)
  const kept = new Set(allowed)

  const skipped: CrawlPlan['skipped'] = []
  for (const url of urls) {
    if (kept.has(url)) continue
    skipped.push({ url, because: whyExcluded(url, origin, options) })
  }

  const pages = allowed.slice(0, maxPages).map((url) => {
    const lastmod = changedAt.get(url)
    return lastmod ? { url, lastmod } : { url }
  })

  return { discovered, pages, skipped, overflow: Math.max(0, allowed.length - maxPages) }
}

/**
 * Which rule dropped a URL.
 *
 * The list on its own answers "what got in". This answers "why not that one",
 * which is the question somebody actually has when a page they expected is
 * missing and they are about to conclude the crawler is broken.
 */
function whyExcluded(url: string, origin: string, options: WebsiteSourceOptions): string {
  let parsed: URL
  try {
    parsed = new URL(url, origin)
  } catch {
    return 'not a usable address'
  }

  if (parsed.origin !== origin) return `on ${parsed.origin}, not ${origin}`

  for (const pattern of options.exclude ?? []) {
    if (parsed.pathname.includes(pattern)) return `matches your exclude ${JSON.stringify(pattern)}`
  }

  for (const pattern of DEFAULT_EXCLUDE) {
    if (parsed.pathname.includes(pattern)) return `matches the built-in exclude ${JSON.stringify(pattern)}`
  }

  if (options.include && !options.include.some((pattern) => parsed.pathname.includes(pattern))) {
    return 'matches none of your include patterns'
  }

  return 'filtered out'
}
