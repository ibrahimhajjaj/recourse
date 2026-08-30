import { safeEqual } from '../util/compare.js'
import { verifyMeta } from './verify.js'
import { acknowledge, answerInBackground, rejected, type ChannelBase, type InboundMessage } from './shared.js'

export interface WhatsAppOptions extends ChannelBase {
  /** From the Meta app dashboard. Signs every webhook. */
  appSecret: string
  /** The string you typed into the dashboard when subscribing. */
  verifyToken: string
  /** The phone number id sending replies. */
  phoneNumberId: string
  accessToken: string
  /** Graph API version. Pinned so a rollover cannot change behaviour silently. */
  apiVersion?: string
  /** Swappable for tests, or to route through your own queue. */
  send?: (to: string, text: string) => Promise<void>
}

interface MetaEnvelope {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
        messages?: Array<{
          from?: string
          id?: string
          type?: string
          text?: { body?: string }
        }>
      }
    }>
  }>
}

/**
 * WhatsApp through Meta's Cloud API.
 *
 * The same endpoint answers two very different requests: a GET that Meta uses
 * once to prove you own the URL, and the POST that carries every message
 * afterwards. Both are handled here so there is one URL to paste into the
 * dashboard.
 */
export function whatsappChannel(options: WhatsAppOptions) {
  const version = options.apiVersion ?? 'v21.0'

  const send =
    options.send ??
    (async (to: string, text: string) => {
      const response = await fetch(`https://graph.facebook.com/${version}/${options.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text.slice(0, 4096) },
        }),
      })

      if (!response.ok) {
        throw new Error(`WhatsApp send failed: ${response.status} ${await response.text()}`)
      }
    })

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // The one-time subscription handshake.
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode')
      const token = url.searchParams.get('hub.verify_token')
      const challenge = url.searchParams.get('hub.challenge')

      if (mode === 'subscribe' && safeEqual(token ?? '', options.verifyToken) && challenge) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
      }
      return rejected('verification failed')
    }

    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    // Read the body as text: the signature covers the exact bytes sent, so
    // parsing first and re-serialising would produce a different string.
    const rawBody = await request.text()
    if (!(await verifyMeta(rawBody, request.headers.get('x-hub-signature-256'), options.appSecret))) {
      return rejected('bad signature')
    }

    let envelope: MetaEnvelope
    try {
      envelope = JSON.parse(rawBody) as MetaEnvelope
    } catch {
      return acknowledge()
    }

    for (const message of extract(envelope)) {
      answerInBackground(options, 'whatsapp', message, async (text, inbound) => {
        await send(inbound.reply.to as string, text)
      })
    }

    // Always 200, even for events we ignored. Anything else and Meta retries
    // the same delivery for a day and a half.
    return acknowledge()
  }
}

function extract(envelope: MetaEnvelope): InboundMessage[] {
  const messages: InboundMessage[] = []

  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const profile = value?.contacts?.[0]

      for (const message of value?.messages ?? []) {
        // Text only for now: a photo or a voice note has nothing to retrieve on.
        if (message.type !== 'text') continue
        const body = message.text?.body?.trim()
        const from = message.from
        if (!body || !from) continue

        messages.push({
          // Keyed by phone number, so a customer picks up where they left off.
          conversationId: `whatsapp:${from}`,
          text: body,
          contact: { id: from, phone: from, name: profile?.profile?.name },
          reply: { to: from },
        })
      }
    }
  }

  return messages
}
