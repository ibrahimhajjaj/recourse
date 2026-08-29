/**
 * The support agent as a Cloudflare Worker.
 *
 * The whole point of this example is what is *not* here: no `nodejs_compat`
 * flag, no polyfills, no adapter. `createChatHandler` returns a
 * `Request -> Response` function, which is exactly what a Worker is.
 *
 * The index is imported, so it is bundled with the Worker and there is nothing
 * to fetch at startup. A cold start is a JSON parse.
 */

import { createChatHandler } from 'helpdeck/server'
// Subpaths, not the root export: `helpdeck` re-exports `ingest`, which reads
// from disk and so imports `node:fs`. Nothing below touches the filesystem.
import { models } from 'helpdeck/models'
import type { KnowledgeIndex } from 'helpdeck/agent'
import knowledge from './knowledge.json'

interface Env extends Record<string, string | undefined> {
  /** A model id for the AI Gateway, or leave it unset for the default. */
  HELPDECK_MODEL?: string
  /** Any OpenAI-compatible endpoint, including Workers AI. */
  OPENAI_COMPATIBLE_BASE_URL?: string
  OPENAI_COMPATIBLE_API_KEY?: string
  OPENAI_COMPATIBLE_MODEL?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname !== '/api/chat') {
      return new Response('POST to /api/chat', { status: 404 })
    }

    // Built per request rather than at module scope: a Worker's environment
    // arrives with the request, not before it.
    const handler = createChatHandler({
      index: knowledge as unknown as KnowledgeIndex,
      // The Worker's variables are passed in rather than read from a global,
      // because there is no `process` here to read one from.
      model: models.fromEnvironment(env),
      // Keyword-only unless an embedder is configured, which needs no
      // credential and is why this runs with nothing set up at all.
      embedder: false,
      persona: {
        name: 'Ada',
        business: 'Lumen Coffee Roasters',
        fallback: "I can't find that in our help pages.",
      },
    })

    return handler(request)
  },
}
