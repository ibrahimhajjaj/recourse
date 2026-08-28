import { verifyMeta } from './verify.js'
import { acknowledge, answerInBackground, rejected, type ChannelBase, type InboundMessage } from './shared.js'
import type { Channel } from '../store/types.js'

/**
 * Messenger and Instagram, which share one webhook shape and one send API.
 *
 * Meta delivers both through the same `messaging` array, keyed by page or
 * account rather than by phone number, so the only real difference between the
 * two is which channel a conversation is filed under.
 */
export interface MetaMessagingOptions extends ChannelBase {
  appSecret: string
  verifyToken: string
  /** Page access token for Messenger, or the Instagram account's token. */
  accessToken: string
  apiVersion?: string
  send?: (recipientId: string, text: string) => Promise<void>
}

interface MessagingEnvelope {
  entry?: Array<{
    messaging?: Array<{
      sender?: { id?: string }
      recipient?: { id?: string }
      message?: { text?: string; is_echo?: boolean; mid?: string }
    }>
  }>
}

export function metaMessagingChannel(channel: Channel, options: MetaMessagingOptions) {
  const version = options.apiVersion ?? 'v21.0'

  const send =
    options.send ??
    (async (recipientId: string, text: string) => {
      const response = await fetch(
        `https://graph.facebook.com/${version}/me/messages?access_token=${encodeURIComponent(options.accessToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientId },
            // Support replies are a response to a message, which is what this
            // tag means; without it Meta blocks sends outside 24 hours.
            messaging_type: 'RESPONSE',
            message: { text: text.slice(0, 2000) },
          }),
        },
      )

      if (!response.ok) {
        throw new Error(`${channel} send failed: ${response.status} ${await response.text()}`)
      }
    })

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET') {
      const challenge = url.searchParams.get('hub.challenge')
      if (
        url.searchParams.get('hub.mode') === 'subscribe' &&
        url.searchParams.get('hub.verify_token') === options.verifyToken &&
        challenge
      ) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
      }
      return rejected('verification failed')
    }

    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const rawBody = await request.text()
    if (!(await verifyMeta(rawBody, request.headers.get('x-hub-signature-256'), options.appSecret))) {
      return rejected('bad signature')
    }

    let envelope: MessagingEnvelope
    try {
      envelope = JSON.parse(rawBody) as MessagingEnvelope
    } catch {
      return acknowledge()
    }

    for (const message of extract(envelope, channel)) {
      answerInBackground(options, channel, message, async (text, inbound) => {
        await send(inbound.reply.to as string, text)
      })
    }

    return acknowledge()
  }
}

function extract(envelope: MessagingEnvelope, channel: Channel): InboundMessage[] {
  const messages: InboundMessage[] = []

  for (const entry of envelope.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      // An echo is the page's own outgoing message coming back; answering it
      // would have the agent talking to itself.
      if (event.message?.is_echo) continue

      const text = event.message?.text?.trim()
      const from = event.sender?.id
      if (!text || !from) continue

      messages.push({
        conversationId: `${channel}:${from}`,
        text,
        contact: { id: from },
        reply: { to: from },
      })
    }
  }

  return messages
}

/** Facebook Messenger. */
export function messengerChannel(options: MetaMessagingOptions) {
  return metaMessagingChannel('messenger', options)
}

/** Instagram direct messages. */
export function instagramChannel(options: MetaMessagingOptions) {
  return metaMessagingChannel('instagram', options)
}
