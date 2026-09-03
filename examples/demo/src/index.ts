/**
 * The public demo: recourse answering questions about itself.
 *
 * One Worker serves everything, because a demo split across two deployments is
 * a demo with two things that can be down. The page, the widget bundle and the
 * chat endpoint all come from here, and the knowledge base is bundled in, so
 * there is no database and nothing to keep running.
 *
 * The model is Cloudflare's own, over its OpenAI-compatible endpoint, so the
 * whole thing needs one account and no third-party key.
 *
 * Everything below assumes the visitor is a stranger who might be hostile,
 * because on a public URL they might be.
 */

import { createChatHandler } from '@recourse-ai/core/server'
import { models, repairNumericContent } from '@recourse-ai/core/models'
import type { KnowledgeIndex } from '@recourse-ai/core/agent'
import { ASSETS } from './assets.js'
import knowledge from './knowledge.json'
import { PAGE } from './page.js'
import { WIDGET, WIDGET_TAG } from './widget.js'

interface Env {
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_AI_TOKEN: string
  /** Overridable so a slower, better model can be tried without a deploy. */
  DEMO_MODEL?: string
}

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/') {
      return new Response(PAGE, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
      })
    }

    // Served from here rather than a CDN so the demo has no second origin to
    // fail, and so what a visitor runs is the bundle in this repository.
    if (url.pathname === '/recourse.js') {
      // The page asks for a specific build, so that one can be cached for as
      // long as a browser likes. A request with no version is somebody's own
      // embed rather than this page, and gets an hour.
      const pinned = url.searchParams.get('v') === WIDGET_TAG
      return new Response(WIDGET, {
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
        },
      })
    }

    // Separate responses rather than data URIs in the page: an image inlined
    // into the markup is a third larger, is re-sent on every visit, and holds
    // up first paint by its own weight.
    if (url.pathname.startsWith('/assets/')) {
      // `hasOwn`, so that `/assets/constructor` is a 404 rather than a 500 on
      // whatever it finds up the prototype chain.
      const name = url.pathname.slice('/assets/'.length)
      if (!Object.hasOwn(ASSETS, name)) return new Response('Not found', { status: 404 })
      const asset = ASSETS[name]!

      const headers = {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        ETag: asset.etag,
      }
      // The name does not carry a hash, so a year-long cache would strand a
      // visitor on an old image. The tag makes the daily revalidation free.
      if (request.headers.get('If-None-Match') === asset.etag) {
        return new Response(null, { status: 304, headers })
      }

      return new Response(decode(asset.base64), { headers })
    }

    if (url.pathname !== '/api/chat') return new Response('Not found', { status: 404 })

    const chat = createChatHandler({
      index: knowledge as unknown as KnowledgeIndex,

      model: models.openaiCompatible({
        name: 'workers-ai',
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
        apiKey: env.CLOUDFLARE_AI_TOKEN,
        model: env.DEMO_MODEL ?? DEFAULT_MODEL,
        // This endpoint sends a token that is valid JSON as what it parses to,
        // so `[1]` arrives with its digit as the number 1 and the answer stops
        // dead when the field is checked against the protocol. Repaired on the
        // way in rather than left to break an answer about pricing.
        fetch: repairNumericContent(),
      }),

      persona: {
        name: 'the recourse demo',
        business: 'recourse, an open source customer support agent',
        instructions:
          'You are answering questions about recourse itself, from its own documentation. ' +
          'Answer only from the sources. Where somebody asks what it costs to run or whether ' +
          'it is any good, quote what the documentation actually measured rather than selling it. ' +
          'If the sources do not cover something, say so and point at the repository.',
        fallback:
          'That is not in the documentation I have. The repository is at ' +
          'github.com/ibrahimhajjaj/recourse if you want to look.',
      },

      // A stranger on a public URL, on somebody's free tier. Twenty questions an
      // hour is plenty to judge whether this is any good and not enough to be
      // worth abusing.
      rateLimit: { limit: 20, windowMs: 60 * 60 * 1000 },

      // Short answers, and a short memory. Both are cost ceilings, and both
      // suit a demo: nobody arrives to read six paragraphs.
      maxOutputTokens: 400,
      maxHistory: 6,
      maxMessageLength: 500,
    })

    return chat(request)
  },
}

/**
 * Decoded on first request and kept, because a Worker isolate serves many
 * requests and the same four images answer all of them.
 */
const decoded = new Map<string, Uint8Array>()

function decode(base64: string): Uint8Array {
  const already = decoded.get(base64)
  if (already) return already

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

  decoded.set(base64, bytes)
  return bytes
}
