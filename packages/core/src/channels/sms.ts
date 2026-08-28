import { verifyTwilio } from './verify.js'
import { answerInBackground, rejected, type ChannelBase, type InboundMessage } from './shared.js'

export interface TwilioOptions extends ChannelBase {
  authToken: string
  /** The number replies come from. */
  from: string
  accountSid: string
  /**
   * The exact public URL Twilio calls, which is part of what it signs. Behind a
   * proxy the request's own URL is the internal one, and the signature will
   * never match unless this is set.
   */
  publicUrl?: string
  send?: (to: string, text: string) => Promise<void>
}

/**
 * SMS through Twilio.
 *
 * Twilio will happily accept a TwiML reply in the webhook response, which is
 * simpler, but that means holding the request open while a model thinks. This
 * acknowledges immediately and sends the answer as a separate message, which
 * is what keeps a slow model from timing the webhook out.
 */
export function twilioChannel(options: TwilioOptions) {
  const send =
    options.send ??
    (async (to: string, text: string) => {
      const body = new URLSearchParams({ To: to, From: options.from, Body: text.slice(0, 1600) })
      const auth = btoa(`${options.accountSid}:${options.authToken}`)

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${options.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        },
      )

      if (!response.ok) throw new Error(`Twilio send failed: ${response.status} ${await response.text()}`)
    })

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const rawBody = await request.text()
    const params: Record<string, string> = {}
    for (const [key, value] of new URLSearchParams(rawBody)) params[key] = value

    const verified = await verifyTwilio({
      signature: request.headers.get('x-twilio-signature'),
      url: options.publicUrl ?? request.url,
      params,
      authToken: options.authToken,
    })
    if (!verified) return rejected('bad signature')

    const from = params.From
    const text = params.Body?.trim()

    if (from && text) {
      const message: InboundMessage = {
        conversationId: `sms:${from}`,
        text,
        contact: { id: from, phone: from },
        reply: { to: from },
      }
      answerInBackground(options, 'sms', message, async (answer, inbound) => {
        await send(inbound.reply.to as string, answer)
      })
    }

    // An empty TwiML response means "received, nothing to say right now".
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
