import { createChatHandler } from 'helpdeck/server'
import { clientAction, collectLeads, escalate, memoryStore, suggestedMessages } from 'helpdeck'
import type { KnowledgeIndex } from 'helpdeck'
import knowledge from '../../../lib/knowledge.json'
import { resolveEmbedder, resolveModel } from '../../../lib/model'

/**
 * The whole server side of the agent. The index is imported, so it is bundled
 * with the function and there is no database to connect to and nothing to warm
 * up: a cold start is a JSON parse.
 */

// In a real shop this would be Postgres or a hosted store. In memory is enough
// to show the transcript, the answer gaps and the leads working end to end.
const store = memoryStore()

const handler = createChatHandler({
  index: knowledge as unknown as KnowledgeIndex,
  model: resolveModel(),
  embedder: resolveEmbedder(),
  store,

  persona: {
    name: 'Nadia',
    business: 'Lumen Coffee Roasters',
    instructions:
      'Customers are usually asking about an order they have already placed. ' +
      'If a question needs their order number or account, ask for it rather than guessing.',
    fallback:
      "I can't find that in our help pages. Email hello@lumen.example and a human will pick it up today.",
  },

  actions: [
    // Captured straight into the store, so nothing is lost if the CRM is down.
    collectLeads({}),

    escalate({
      createTicket(ticket) {
        console.log('[helpdeck] ticket:', ticket.subject, `(${ticket.priority})`)
        return { id: `LUM-${Math.floor(Math.random() * 9000 + 1000)}` }
      },
    }),

    suggestedMessages({ max: 3 }),

    // Runs in the visitor's browser, because only the page knows what is in
    // the basket. The server never sees the cart, it just gets the answer.
    clientAction({
      name: 'read_basket',
      whenToUse:
        "Use when the customer asks what is in their basket, what they are about to buy, or what their order total is.",
    }),
  ],

  // Public endpoint, so cap what one visitor can spend.
  rateLimit: { limit: 20, windowMs: 60_000 },

  onConversation({ question, unanswered }) {
    if (unanswered) console.log('[helpdeck] no sources matched:', question)
  },
})

export const POST = handler
export const OPTIONS = handler

// Long enough for a slow model to finish streaming a real answer.
export const maxDuration = 60
