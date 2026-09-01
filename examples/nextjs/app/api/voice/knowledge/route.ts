import { createAgent, httpAction, type KnowledgeIndex } from '@recourse-ai/core'
import { elevenLabsToolRoute } from '@recourse-ai/core/channels'
import knowledge from '../../../../lib/knowledge.json'
import { store } from '../../../../lib/helpdesk'
import { siteUrl } from '../../../../lib/site'
import { resolveEmbedder, resolveVoiceModel } from '../../../../lib/model'

/**
 * What the voice agent asks when it does not know something.
 *
 * The division of labour is the whole design. The voice service owns the call:
 * the turn-taking, the interruptions, the voice itself, all the parts that have
 * to happen in milliseconds. It does not own the shop's documentation or its
 * orders, so it calls this mid-sentence and reads back what comes out.
 *
 * The order lookup is here rather than only in the chat route because it is the
 * difference between a demo and a support agent: anybody can make a model talk,
 * and the useful part is that it can say where the parcel actually is.
 */

const agent = createAgent({
  index: knowledge as unknown as KnowledgeIndex,
  model: resolveVoiceModel(),
  // A spoken answer is finished when the caller has what they asked for. The
  // instruction below asks for brevity and this is the backstop for a model
  // that ignores it, measured after one returned 59 words for a one-line
  // question. Roughly two or three sentences of speech.
  maxOutputTokens: 120,
  embedder: resolveEmbedder(),
  store,

  persona: {
    name: 'Nadia',
    business: 'Lumen Coffee Roasters',
    // Spoken, not read. A citation marker is noise out loud and a paragraph is
    // too long to listen to, so the answer is written for an ear.
    instructions:
      'You are being read aloud on a phone call. Answer in one or two short sentences, ' +
      'in plain spoken English, with no markdown and no citation markers. ' +
      'If the customer asks about a specific order, ask for the order number and look it up.',
    fallback: "I can't find that in our help pages. Shall I put you through to someone?",
  },

  actions: [
    httpAction({
      name: 'lookup_order',
      whenToUse: 'Look up an order by its number, when the customer gives you one.',
      collect: [{ name: 'orderNumber', type: 'string', description: 'The order number, like LUM-1234.' }],
      url: `${siteUrl()}/api/orders/{{orderNumber}}`,
      allowFields: ['orderNumber', 'placedAt', 'weightKg', 'status', 'wholesale'],
    }),
  ],
})

/**
 * Bearer token, checked on every call.
 *
 * Without it this endpoint answers anybody who finds the URL, and every answer
 * costs a model call. It is a secret you invent here and paste into the voice
 * service's tool configuration, on both sides.
 */
const handler = elevenLabsToolRoute({
  agent,
  token: process.env.ELEVENLABS_TOOL_TOKEN ?? '',
})

export const POST = handler
export const GET = handler

export const maxDuration = 30
