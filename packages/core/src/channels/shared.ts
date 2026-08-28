import type { Agent } from '../agent.js'
import type { Channel } from '../store/types.js'
import type { Contact } from '../actions/types.js'

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
}

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
      const { text } = await options.agent.answer(message.text, [], {
        conversationId: message.conversationId,
        contact: message.contact,
        channel,
      })
      if (text.trim()) await deliver(text, message)
    } catch (error) {
      options.onError?.(error, { channel, conversationId: message.conversationId })
      // Logged rather than rethrown: nothing is listening, and an unhandled
      // rejection would take the whole worker down with it.
      console.error(`[helpdeck] ${channel} turn failed`, error)
    }
  })()

  if (options.waitUntil) options.waitUntil(work)
}

/** Acknowledges a webhook. Platforms only care that it was a 200. */
export function acknowledge(body = ''): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

export function rejected(reason: string): Response {
  return new Response(reason, { status: 401 })
}
