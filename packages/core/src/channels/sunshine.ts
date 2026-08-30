import { acknowledge, answerInBackground, rejected, type ChannelBase, type InboundMessage } from './shared.js'
import { safeEqual } from './verify.js'

/**
 * Sunshine Conversations, which is Zendesk's messaging platform.
 *
 * Worth having for one reason: it is an aggregator. A single integration here
 * reaches WhatsApp, Messenger, Instagram, Telegram, LINE, WeChat, Viber and
 * SMS, because Sunshine has already done the per-platform work and hands every
 * one of them over in the same envelope. The `source.type` on each message says
 * which channel it actually came from.
 *
 * It is also the only channel here that does not sign anything. A shared secret
 * arrives in `X-API-Key`, generated when the webhook is created, and comparing
 * it is the whole of the security model. That is Zendesk's design, not a
 * shortcut taken here, and it means the secret is worth protecting the way a
 * password is: anyone holding it can post anything to your endpoint.
 */

export interface SunshineOptions extends ChannelBase {
  /** The secret Sunshine generated when the webhook was created. */
  webhookSecret: string
  /** Your app id, from the Sunshine dashboard. */
  appId: string
  /** An API key pair, used as basic auth on the way back out. */
  keyId: string
  keySecret: string
  /**
   * Tells Sunshine the message came from AI, so it appends its own disclaimer
   * on the customer's channel.
   *
   * On by default, because it is the platform doing the disclosure properly:
   * Sunshine applies it per channel, in the customer's own client, for text,
   * image and file messages alike. Set `disclosure` as well and the customer
   * is told twice, so pick one. This is the better one where it is available.
   */
  aiDisclaimer?: boolean
  send?: (conversationId: string, text: string) => Promise<void>
}

interface SunshineEvent {
  type?: string
  payload?: {
    conversation?: { id?: string }
    message?: {
      id?: string
      author?: { type?: string; userId?: string; displayName?: string; subtypes?: string[] }
      content?: { type?: string; text?: string }
      source?: { type?: string }
    }
  }
}

interface SunshineWebhook {
  app?: { id?: string }
  events?: SunshineEvent[]
}

export function sunshineChannel(options: SunshineOptions) {
  const send =
    options.send ??
    (async (conversationId: string, text: string) => {
      const auth = btoa(`${options.keyId}:${options.keySecret}`)

      const response = await fetch(
        `https://api.smooch.io/v2/apps/${encodeURIComponent(options.appId)}/conversations/${encodeURIComponent(
          conversationId,
        )}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            author: {
              type: 'business',
              // One subtype at most, which the schema enforces.
              ...(options.aiDisclaimer === false ? {} : { subtypes: ['AI'] }),
            },
            content: { type: 'text', text },
          }),
        },
      )

      if (!response.ok) {
        throw new Error(`Sunshine send failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
      }
    })

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    // Compared in constant time even though it is only a shared secret: the
    // comparison is the entire check, so there is nothing else to fall back on.
    const presented = request.headers.get('x-api-key') ?? ''
    if (!presented || !safeEqual(presented, options.webhookSecret)) return rejected('bad secret')

    let body: SunshineWebhook
    try {
      body = (await request.json()) as SunshineWebhook
    } catch {
      return acknowledge()
    }

    for (const event of body.events ?? []) {
      const message = extract(event)
      if (!message) continue

      answerInBackground(options, 'sunshine', message, async (text, inbound) => {
        await send(inbound.reply.conversationId as string, text)
      })
    }

    // Always, and quickly. Sunshine retries five times over fifteen minutes and
    // treats no response within twenty seconds as a failure, so a slow answer
    // earns the customer the same reply five times.
    return acknowledge()
  }
}

function extract(event: SunshineEvent): InboundMessage | null {
  if (event.type !== 'conversation:message') return null

  const message = event.payload?.message
  const conversationId = event.payload?.conversation?.id
  if (!message || !conversationId) return null

  // Anything the business said, including this agent's own replies, comes back
  // through the same webhook. Answering those is a conversation with itself.
  if (message.author?.type !== 'user') return null

  const text = message.content?.type === 'text' ? (message.content.text ?? '').trim() : ''
  if (!text) return null

  return {
    conversationId: `sunshine:${conversationId}`,
    text,
    contact: message.author.userId
      ? { id: message.author.userId, name: message.author.displayName }
      : undefined,
    reply: { conversationId, channel: message.source?.type ?? 'unknown' },
  }
}
