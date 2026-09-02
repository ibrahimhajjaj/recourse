import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildIndex } from '../src/knowledge/build.js'
import { websiteSource } from '../src/sources/website.js'
import type { KnowledgeIndex } from '../src/types.js'

const ORIGIN = 'https://shop.example'

const sitemap = (entries: Array<[string, string?]>) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset>${entries
    .map(([loc, lastmod]) => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`)
    .join('')}</urlset>`

const PAGES: Record<string, string> = {
  [`${ORIGIN}/refunds`]: '# Refunds\n\nWe refund any order within 30 days of delivery. Engraved items are final sale.',
  [`${ORIGIN}/shipping`]: '# Shipping\n\nOrders ship within two business days. Delivery to the EU takes about a week.',
}

/** Counts what a build actually paid for: one scrape is one page read. */
function site(entries: Array<[string, string?]>) {
  const scraped: string[] = []

  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)

    if (url.endsWith('/sitemap.xml')) {
      return new Response(sitemap(entries), { status: 200 })
    }

    if (url.includes('/scrape')) {
      const asked = JSON.parse(String(init?.body)).url as string
      scraped.push(asked)

      return Response.json({
        success: true,
        data: { markdown: PAGES[asked] ?? '', metadata: { title: asked, statusCode: 200 } },
      })
    }

    return new Response('', { status: 404 })
  })

  vi.stubGlobal('fetch', fetcher)

  return { scraped }
}

afterEach(() => vi.unstubAllGlobals())

const build = (previous?: KnowledgeIndex) =>
  buildIndex({
    sources: [websiteSource({ url: ORIGIN })],
    ...(previous ? { previous } : {}),
  })

describe('re-crawling a site that publishes lastmod', () => {
  it('does not read a page again when the site says it has not changed', async () => {
    const first = site([
      [`${ORIGIN}/refunds`, '2026-01-01'],
      [`${ORIGIN}/shipping`, '2026-01-01'],
    ])
    const before = await build()

    expect(first.scraped).toHaveLength(2)
    expect(before.fetched?.[`${ORIGIN}/refunds`]?.lastModified).toBe('2026-01-01')

    const second = site([
      [`${ORIGIN}/refunds`, '2026-01-01'],
      [`${ORIGIN}/shipping`, '2026-02-01'],
    ])
    const after = await build(before)

    // Only the page whose date moved was paid for.
    expect(second.scraped).toEqual([`${ORIGIN}/shipping`])

    // And the one that was skipped is still in the index, in full.
    expect(after.stats.documents).toBe(2)
    const refunds = after.chunks.filter((chunk) => chunk.docId === `${ORIGIN}/refunds`)
    expect(refunds.length).toBeGreaterThan(0)
    expect(refunds.map((chunk) => chunk.text).join(' ')).toContain('30 days')
  })

  it('reads everything again when the site publishes no dates', async () => {
    site([[`${ORIGIN}/refunds`], [`${ORIGIN}/shipping`]])
    const before = await build()

    const second = site([[`${ORIGIN}/refunds`], [`${ORIGIN}/shipping`]])
    await build(before)

    // No signal means no shortcut. Guessing here would freeze a site's content.
    expect(second.scraped).toHaveLength(2)
  })

  it('reads a page again once its date moves, and replaces the old text', async () => {
    site([[`${ORIGIN}/refunds`, '2026-01-01']])
    const before = await build()
    expect(before.chunks.map((chunk) => chunk.text).join(' ')).toContain('30 days')

    PAGES[`${ORIGIN}/refunds`] = '# Refunds\n\nWe refund any order within 14 days of delivery. No exceptions at all.'
    site([[`${ORIGIN}/refunds`, '2026-03-01']])
    const after = await build(before)

    const text = after.chunks.map((chunk) => chunk.text).join(' ')
    expect(text).toContain('14 days')
    expect(text).not.toContain('30 days')

    PAGES[`${ORIGIN}/refunds`] = '# Refunds\n\nWe refund any order within 30 days of delivery. Engraved items are final sale.'
  })

  it('reads a page it has no chunks for, however old the date is', async () => {
    // A page dropped from a previous index has nothing to carry over, so
    // trusting its date would quietly remove it from the knowledge base.
    site([[`${ORIGIN}/refunds`, '2026-01-01']])
    const before = await build()

    const stripped: KnowledgeIndex = {
      ...before,
      chunks: before.chunks.filter((chunk) => chunk.docId !== `${ORIGIN}/refunds`),
    }

    const second = site([[`${ORIGIN}/refunds`, '2026-01-01']])
    await build(stripped)

    expect(second.scraped).toEqual([`${ORIGIN}/refunds`])
  })
})
