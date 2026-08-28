import { createChatHandler } from 'helpdeck/server'
import type { KnowledgeIndex } from 'helpdeck'
import knowledge from '../../../lib/knowledge.json'
import { resolveEmbedder, resolveModel } from '../../../lib/model'

/**
 * The entire server side of the agent. The index is imported, so it is bundled
 * with the function and there is no database to connect to and nothing to warm
 * up: a cold start is a JSON parse.
 */
const handler = createChatHandler({
  index: knowledge as unknown as KnowledgeIndex,
  model: resolveModel(),
  embedder: resolveEmbedder(),

  persona: {
    name: 'Nadia',
    business: 'Lumen Coffee Roasters',
    instructions:
      'Customers are usually asking about an order they have already placed. ' +
      'If a question needs their order number or account, ask for it rather than guessing.',
    fallback:
      "I can't find that in our help pages. Email hello@lumen.example and a human will pick it up today.",
  },

  // Public endpoint, so cap what one visitor can spend.
  rateLimit: { limit: 20, windowMs: 60_000 },

  // Every unanswered question is a gap in the documentation worth knowing about.
  onConversation({ question, unanswered }) {
    if (unanswered) console.log('[helpdeck] no sources matched:', question)
  },
})

export const POST = handler
export const OPTIONS = handler

// Long enough for a slow model to finish streaming a real answer.
export const maxDuration = 60
