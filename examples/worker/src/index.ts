/**
 * The support agent as a Cloudflare Worker.
 *
 * The whole point of this example is what is *not* here: no `nodejs_compat`
 * flag, no polyfills, no adapter. `createChatHandler` returns a
 * `Request -> Response` function, which is exactly what a Worker is.
 *
 * The index is imported, so it is bundled with the Worker and there is nothing
 * to fetch at startup. A cold start is a JSON parse.
 *
 * Attachments go to R2 through a binding, which is the part a Worker does
 * better than anywhere else: no credentials in the environment, no signature
 * to compute, and the bytes never leave Cloudflare's network on the way in.
 */

import { createChatHandler, uploadRoute, downloadRoute } from '@recourse-ai/core/server'
import { r2Blobs, type R2Like } from '@recourse-ai/core/storage'
// Subpaths, not the root export: `recourse` re-exports `ingest`, which reads
// from disk and so imports `node:fs`. Nothing below touches the filesystem.
import { models } from '@recourse-ai/core/models'
import type { KnowledgeIndex } from '@recourse-ai/core/agent'
import knowledge from './knowledge.json'

interface Env {
  /** A model id for the AI Gateway, or leave it unset for the default. */
  RECOURSE_MODEL?: string
  /** Any OpenAI-compatible endpoint, including Workers AI. */
  OPENAI_COMPATIBLE_BASE_URL?: string
  OPENAI_COMPATIBLE_API_KEY?: string
  OPENAI_COMPATIBLE_MODEL?: string
  /** The R2 bucket, from `wrangler.jsonc`. Absent until one is configured. */
  ATTACHMENTS?: R2Like
  /**
   * Signs the keys the upload route hands out, so a browser cannot name
   * somebody else's file. `wrangler secret put RECOURSE_UPLOAD_SECRET`.
   */
  RECOURSE_UPLOAD_SECRET?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Storage is optional. Without a bucket bound, the agent still answers and
    // still takes small inline attachments; it just has nowhere to put a
    // 20MB scan.
    const storage =
      env.ATTACHMENTS && env.RECOURSE_UPLOAD_SECRET
        ? {
            // No `publicBase`: this bucket is private, so there is no URL a
            // model provider could fetch. Images are sent as bytes instead,
            // which is also the only thing that works for a model on a
            // private network. Put a custom domain on the bucket and pass it
            // here if you would rather hand out links.
            blobs: r2Blobs(env.ATTACHMENTS),
            secret: env.RECOURSE_UPLOAD_SECRET,
          }
        : undefined

    if (url.pathname === '/api/upload' && storage) {
      return uploadRoute({ ...storage, cors: {} })(request)
    }

    if (url.pathname === '/api/file' && storage) {
      return downloadRoute({ ...storage, cors: {} })(request)
    }

    if (url.pathname !== '/api/chat') {
      return new Response('POST to /api/chat', { status: 404 })
    }

    // Built per request rather than at module scope: a Worker's environment
    // arrives with the request, not before it.
    const handler = createChatHandler({
      index: knowledge as unknown as KnowledgeIndex,
      // The Worker's variables are passed in rather than read from a global,
      // because there is no `process` here to read one from.
      model: models.fromEnvironment(env as Record<string, string | undefined>),
      // Keyword-only unless an embedder is configured, which needs no
      // credential and is why this runs with nothing set up at all.
      embedder: false,
      persona: {
        name: 'Ada',
        business: 'Lumen Coffee Roasters',
        fallback: "I can't find that in our help pages.",
      },
      ...(storage ? { storage } : {}),
    })

    return handler(request)
  },
}
