import type { Agent } from '../agent.js'
import type { Channel } from '../store/types.js'
import type { Contact } from '../actions/types.js'
import type { Message, SourceRef } from '../types.js'

export interface ChannelBase {
  agent: Agent
  /**
   * Hands background work to the platform so a serverless function is not
   * frozen the moment it responds. Vercel and Cloudflare both provide one;
   * on a long-lived Node server it can be left out.
   */
  waitUntil?: (promise: Promise<unknown>) => void
  /** Called when a turn fails, so a dropped message is not silently dropped. */
  onError?: (error: unknown, context: { channel: Channel; conversationId: string }) => void
  /**
   * Said once, before the first answer in a conversation.
   *
   * On a messaging channel there is no interface to put this in: no header, no
   * footnote, no avatar with a label under it. The message is the only surface
   * there is, so the disclosure has to be part of it.
   *
   * EU AI Act Article 50(5) wants it at or before the first interaction, and
   * the exception for cases where it is obvious does not cover a support
   * assistant. Answering honestly when somebody asks is a different thing and
   * does not satisfy it, which is worth stating plainly because it is an easy
   * thing to assume.
   *
   * Off unless set. A deployment outside the EU may not need it, one inside it
   * does, and neither is ours to decide from here. `defaultDisclosure` is a
   * wording that works.
   */
  disclosure?: string
  /**
   * Whether to list the cited sources under the answer.
   *
   * A chat widget renders [1] as a link because it gets the source list beside
   * the text. A messaging channel gets a string, so without this the customer
   * reads a footnote marker with no footnote. `none` for a channel where the
   * links are noise, or where the reader cannot follow them anyway.
   */
  citations?: Citations
}

/** How a messaging channel should handle the [1] the prompt asks for. */
export type Citations = 'list' | 'none'

/**
 * A disclosure that satisfies the requirement without sounding like a notice.
 *
 * Exported so a deployment can start from it rather than from a blank string,
 * and translate it rather than write it. Article 50 asks for clear and
 * distinguishable, not for legal register.
 */
export const defaultDisclosure = "Just so you know, you're chatting with an AI assistant, not a person."

export interface InboundMessage {
  /** Stable per person or per thread, so history follows the conversation. */
  conversationId: string
  text: string
  contact?: Contact
  /** Where to send the reply, in whatever shape the platform needs. */
  reply: Record<string, string>
}

/**
 * Answers in the background and delivers the result.
 *
 * Every messaging platform retries a webhook it thinks failed, and Slack gives
 * you three seconds before it decides that. A model takes longer than that on
 * a good day, so the only correct shape is: verify, acknowledge, then answer.
 * Doing the work inline earns duplicate messages to the customer.
 */
export function answerInBackground(
  options: ChannelBase,
  channel: Channel,
  message: InboundMessage,
  deliver: (text: string, message: InboundMessage) => Promise<void>,
): void {
  const work = (async () => {
    try {
      // Read before the turn runs, because the turn writes the customer's
      // message to the store and would otherwise hand the model its own copy
      // of the question it is being asked.
      const prior = await recent(options, message.conversationId)
      const first = !prior.some((earlier) => earlier.role === 'assistant')

      const { text, sources } = await options.agent.answer(message.text, prior, {
        conversationId: message.conversationId,
        contact: message.contact,
        channel,
      })

      // Its own message rather than a prefix. Article 50 asks for clear and
      // distinguishable, and a sentence welded onto the front of an answer
      // about delivery times is neither.
      if (first && options.disclosure) await deliver(options.disclosure, message)
      if (text.trim()) await deliver(withSources(text, sources, options.citations), message)
    } catch (error) {
      options.onError?.(error, { channel, conversationId: message.conversationId })
      // Logged rather than rethrown: nothing is listening, and an unhandled
      // rejection would take the whole worker down with it.
      console.error(`[recourse] ${channel} turn failed`, error)
    }
  })()

  if (options.waitUntil) options.waitUntil(work)
}

/**
 * How much of the exchange to carry into the next answer.
 *
 * Enough that "and to the UK?" still means something several questions later,
 * short enough that a conversation running all afternoon does not quietly
 * grow the cost of every turn. Five exchanges.
 */
const CARRIED = 10

/**
 * What has already been said in this conversation.
 *
 * Without this a messaging channel answers every message as though it were the
 * first thing anybody had ever said. The customer asks "do you ship to
 * Ireland?", gets an answer, asks "and to the UK?", and is met with a request
 * to rephrase, because on its own that sentence means nothing. The transcript
 * was being written down and never read back.
 *
 * With no store there is no transcript and so no history, and no way to tell
 * whether the disclosure has been said before. Both fall the safe way: the
 * question is answered on its own, and anything said once per conversation is
 * said again. Hearing the disclosure twice is mildly annoying; never hearing
 * it is the thing the law is about.
 */
async function recent(options: ChannelBase, conversationId: string): Promise<Message[]> {
  const store = options.agent.store
  if (!store) return []

  try {
    const thread = await store.getConversation(conversationId)
    return (thread?.messages ?? [])
      .slice(-CARRIED)
      .map((message) => ({ role: message.role, content: message.content }))
  } catch {
    // A store that cannot be read costs the history, not the answer.
    return []
  }
}

/**
 * Puts the cited sources under the answer.
 *
 * The prompt tells the model to write [1], and a chat widget renders those as
 * links because it is given the source list alongside the text. A messaging
 * channel is given a string and nothing else, so for as long as this did not
 * exist the customer got a footnote marker with no footnote: a live Discord
 * answer read "Delivery to Ireland takes 3-5 working days. [1]" and there was
 * no way to find out what [1] was.
 *
 * Only what the answer actually cited is listed, because the agent already
 * narrows the list that way, and retrieval deliberately over-fetches. A source
 * with no URL is still worth naming; a text source added through the API has a
 * title and no address, and "Refund policy" tells the reader more than nothing.
 */
function withSources(text: string, sources: SourceRef[], style: Citations = 'list'): string {
  if (style === 'none' || sources.length === 0) return text
  if (!/\[\d{1,2}\]/.test(text)) return text

  const lines = sources.map((source, position) => {
    const name = [source.title, source.section].filter(Boolean).join(' > ')
    return source.url ? `[${position + 1}] ${name}: ${source.url}` : `[${position + 1}] ${name}`
  })

  return `${text}\n\n${lines.join('\n')}`
}

/** Acknowledges a webhook. Platforms only care that it was a 200. */
export function acknowledge(body = ''): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

export function rejected(reason: string): Response {
  return new Response(reason, { status: 401 })
}
