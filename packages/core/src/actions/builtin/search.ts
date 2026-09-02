import { defineAction } from '../define.js'
import type { Action } from '../types.js'
import { fetchWithRetry } from '../../util/http.js'

export interface WebSearchOptions {
  whenToUse?: string
  /** Results handed to the model. More costs context for little gain. */
  limit?: number
  /** Raises Firecrawl's rate limits. Search works without one. */
  apiKey?: string
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

  return defineAction({
    name: 'search_the_web',
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
        { method: 'POST', headers, body: JSON.stringify({ query: String(input.query ?? ''), limit }) },
        { signal: ctx.signal, attempts: 2 },
      )

      if (!response.ok) throw new Error(`web search unavailable (${response.status})`)

      const body = (await response.json()) as {
        data?: { web?: Array<{ url?: string; title?: string; description?: string }> }
      }

      const results = (body.data?.web ?? []).slice(0, limit).map((item) => ({
        title: item.title ?? '',
        url: item.url ?? '',
        // Trimmed hard: a search snippet is a pointer, not the answer.
        snippet: (item.description ?? '').slice(0, 400),
      }))

      return { results, note: 'Cite these by URL and say the information came from the web.' }
    },
  })
}
