import { afterEach, describe, expect, it, vi } from 'vitest'
import { planCrawl } from '../src/sources/website.js'

const ORIGIN = 'https://shop.example'

const sitemap = (entries: Array<[string, string?]>) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset>${entries
    .map(([loc, lastmod]) => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`)
    .join('')}</urlset>`

function site(entries: Array<[string, string?]>) {
  const fetched: string[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      fetched.push(url)

      if (url.endsWith('/sitemap.xml')) return new Response(sitemap(entries), { status: 200 })

      return new Response('', { status: 404 })
    }),
  )

  return { fetched }
}

afterEach(() => vi.unstubAllGlobals())

describe('seeing what a crawl would read', () => {
  it('lists the pages without reading any of them', async () => {
    const { fetched } = site([
      [`${ORIGIN}/refunds`, '2026-01-01'],
      [`${ORIGIN}/shipping`],
    ])

    const plan = await planCrawl({ url: ORIGIN })

    expect(plan.discovered).toBe('sitemap')
    expect(plan.pages.map((page) => page.url)).toEqual([`${ORIGIN}/refunds`, `${ORIGIN}/shipping`])
    expect(plan.pages[0]?.lastmod).toBe('2026-01-01')

    // The whole point: this costs one request for the sitemap and nothing else.
    // A preview that quietly crawls is not a preview.
    expect(fetched.every((url) => url.includes('sitemap'))).toBe(true)
    expect(fetched.some((url) => url.includes('/scrape'))).toBe(false)
  })

  it('says which rule dropped each page it left out', async () => {
    site([
      [`${ORIGIN}/refunds`],
      [`${ORIGIN}/wp-login.php`],
      [`${ORIGIN}/legacy/press-2011`],
      ['https://other.example/refunds'],
    ])

    const plan = await planCrawl({ url: ORIGIN, exclude: ['/legacy'] })

    expect(plan.pages.map((page) => page.url)).toEqual([`${ORIGIN}/refunds`])

    const why = Object.fromEntries(plan.skipped.map((entry) => [entry.url, entry.because]))
    // "Why is my page missing" is the actual question, and a bare list of what
    // got in does not answer it.
    expect(why[`${ORIGIN}/legacy/press-2011`]).toContain('your exclude')
    expect(why[`${ORIGIN}/wp-login.php`]).toContain('built-in')
    expect(why['https://other.example/refunds']).toContain('not https://shop.example')
  })

  it('reports how many pages the ceiling would cut', async () => {
    site(Array.from({ length: 12 }, (_, index) => [`${ORIGIN}/page-${index}`] as [string]))

    const plan = await planCrawl({ url: ORIGIN, maxPages: 5 })

    expect(plan.pages).toHaveLength(5)
    expect(plan.overflow).toBe(7)
  })

  it('says plainly when it cannot preview a site without crawling it', async () => {
    // No sitemap and no llms.txt means discovery is following links, and
    // following links means fetching pages. An empty list would read as "this
    // site has nothing on it", which is a different and wrong answer.
    site([])

    const plan = await planCrawl({ url: ORIGIN })

    expect(plan.discovered).toBe('links')
    expect(plan.pages).toEqual([])
  })
})
