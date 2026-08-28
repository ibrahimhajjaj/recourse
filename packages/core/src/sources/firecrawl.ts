import { fetchWithRetry } from '../util/http.js'

const API = 'https://api.firecrawl.dev/v2'

/**
 * Firecrawl went keyless in June 2026: /scrape and /search answer without an
 * Authorization header and every caller gets 1,000 credits a month. That is the
 * reason this project can promise a working agent with nothing to sign up for.
 *
 * Keyless does NOT cover /map or /crawl, which is why discovery below is built
 * on sitemaps and link-following rather than the crawl endpoint. Supplying a
 * key raises the limits but changes no behaviour.
 */
export interface FirecrawlOptions {
  apiKey?: string
  signal?: AbortSignal
  /**
   * Retries before giving up on one page. A crawl can afford to be patient;
   * a rebuild touching a hundred links cannot, since every dead one costs the
   * full backoff before the build moves on.
   */
  attempts?: number
}

export interface ScrapedPage {
  markdown: string
  title: string
  links: string[]
  statusCode?: number
}

function headers(apiKey?: string): Record<string, string> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) base.Authorization = `Bearer ${apiKey}`
  return base
}

export async function scrape(
  url: string,
  formats: Array<'markdown' | 'links'>,
  options: FirecrawlOptions = {},
): Promise<ScrapedPage | null> {
  const response = await fetchWithRetry(
    `${API}/scrape`,
    {
      method: 'POST',
      headers: headers(options.apiKey),
      body: JSON.stringify({ url, formats, onlyMainContent: true }),
    },
    { signal: options.signal, attempts: options.attempts },
  )

  if (!response.ok) {
    // 402 is the credit wall. Anything else on a single page is that page's
    // problem, so the crawl skips it rather than dying halfway through.
    if (response.status === 402) {
      throw new Error(
        'Firecrawl free credits are exhausted for this month. Set FIRECRAWL_API_KEY to continue.',
      )
    }
    return null
  }

  const body = (await response.json()) as {
    success?: boolean
    data?: {
      markdown?: string
      links?: string[]
      metadata?: { title?: string; statusCode?: number }
    }
  }

  if (!body.success || !body.data) return null

  return {
    markdown: body.data.markdown ?? '',
    title: body.data.metadata?.title ?? url,
    links: body.data.links ?? [],
    statusCode: body.data.metadata?.statusCode,
  }
}
