import { defineAction } from '../define.js'
import type { Action } from '../types.js'
import { fetchWithRetry } from '../../util/http.js'
import type { Channel } from '../../store/types.js'

export interface WebSearchOptions {
  /**
   * The channels this is offered on. Unset means all of them.
   *
   * Some of these only work in one place, and some are a policy rather than a
   * capability: a refund you are happy to let the agent issue to somebody who
   * signed in on the website is a different proposition over SMS.
   */
  channels?: Channel[]
  /**
   * The tool name, when one is not enough.
   *
   * Two of the same action is a real configuration: escalations on the website
   * and on Instagram, with different rules and different details to gather.
   * They need different names, since the tool set is keyed on the name and two
   * actions sharing one is refused rather than one quietly replacing the other.
   */
  name?: string
  whenToUse?: string
  /** Results handed to the model. More costs context for little gain. */
  limit?: number
  /** Raises Firecrawl's rate limits. Search works without one. */
  apiKey?: string
  /**
   * Sites the search is confined to, as bare hosts: `['gov.uk', 'hmrc.gov.uk']`.
   *
   * Unset searches the open web, which is right for a general question and
   * wrong for a shop whose answers should come from its own manufacturer and
   * carrier pages rather than from whoever ranks well today.
   */
  sites?: string[]
  /**
   * Also search for pictures, and let the answer show one.
   *
   * Worth having where the answer is a thing rather than a fact: which of the
   * three fittings this is, what the part looks like, which end of the cable
   * goes where. Off by default, because most support answers are sentences and
   * a picture of roughly the right object is worse than none.
   */
  images?: boolean
}

/**
 * Live web search, through Firecrawl's keyless tier.
 *
 * A knowledge base is a snapshot; some questions are about now. This closes
 * that gap without a second vendor or a second key, since the same keyless
 * allowance already powers ingestion.
 */
export function webSearch(options: WebSearchOptions = {}): Action {
  const limit = options.limit ?? 4

  const sites = (options.sites ?? []).map((site) => site.trim()).filter(Boolean)

  return defineAction({
    name: options.name ?? 'search_the_web',
    ...(options.channels ? { channels: options.channels } : {}),
    whenToUse:
      options.whenToUse ??
      'Use only when the documentation does not cover the question and the answer depends on ' +
        'current public information. Do not use it for questions about this business, its ' +
        'pricing, its policies or a specific order: those come from the documentation.',

    collect: [{ name: 'query', type: 'string', description: 'A focused search query, not a sentence.' }],

    // What is being searched for, rather than the bare fact that a search is
    // happening. It is what the visitor is waiting on, so it is what they read.
    summarise: (input) => `Searching for ${String(input.query ?? '').slice(0, 60)}`,

    async execute(input, ctx) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`


      const response = await fetchWithRetry(
        'https://api.firecrawl.dev/v2/search',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: String(input.query ?? ''),
            limit,
            ...(sites.length > 0 ? { includeDomains: sites } : {}),
            ...(options.images ? { sources: ['web', 'images'] } : {}),
          }),
        },
        { signal: ctx.signal, attempts: 2 },
      )

      if (!response.ok) throw new Error(`web search unavailable (${response.status})`)

      const body = (await response.json()) as {
        data?: {
          web?: Array<{ url?: string; title?: string; description?: string }>
          images?: Array<{ url?: string; title?: string; imageUrl?: string }>
        }
      }

      const results = (body.data?.web ?? []).slice(0, limit).map((item) => ({
        title: item.title ?? '',
        url: item.url ?? '',
        // Trimmed hard: a search snippet is a pointer, not the answer.
        snippet: (item.description ?? '').slice(0, 400),
      }))

      const note = 'Cite these by URL and say the information came from the web.'
      if (!options.images) return { results, note }

      const pictures = (body.data?.images ?? [])
        .filter((item) => typeof item.imageUrl === 'string' && item.imageUrl.startsWith('https:'))
        .slice(0, 3)
        .map((item) => ({ title: item.title ?? '', image: item.imageUrl as string, page: item.url ?? '' }))

      return {
        results,
        images: pictures,
        note:
          `${note} At most one picture, written as ![description](image url), and only where seeing ` +
          'the thing is the answer. Never one that merely decorates a reply.',
      }
    },
  })
}
