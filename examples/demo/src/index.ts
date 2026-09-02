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
import { models } from '@recourse-ai/core/models'
import type { KnowledgeIndex } from '@recourse-ai/core/agent'
import knowledge from './knowledge.json'
import { PAGE } from './page.js'
import { WIDGET } from './widget.js'

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
      return new Response(WIDGET, {
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    if (url.pathname !== '/api/chat') return new Response('Not found', { status: 404 })

    const chat = createChatHandler({
      index: knowledge as unknown as KnowledgeIndex,

      model: models.openaiCompatible({
        name: 'workers-ai',
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
        apiKey: env.CLOUDFLARE_AI_TOKEN,
        model: env.DEMO_MODEL ?? DEFAULT_MODEL,
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
