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
      const auth = btoa(`${options.accountSid}:${options.authToken}`)

      // Sent one after another rather than at once, because they arrive in the
      // order they were accepted and a second half that lands first reads as
      // nonsense.
      for (const part of split(text, SMS_LIMIT)) {
        const body = new URLSearchParams({ To: to, From: options.from, Body: part })

        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${options.accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          },
        )

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { code?: number; message?: string }
          throw new Error(explain(body, response.status))
        }
      }
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

/** What Twilio accepts in one request. Longer than this is a second message. */
const SMS_LIMIT = 1600

/**
 * Breaks an answer into messages Twilio will accept.
 *
 * Truncating instead is worse than it looks: the customer is not told the
 * answer was cut, so a reply ending "returns are free within" reads as a
 * complete sentence that happens to be wrong.
 *
 * Split at a paragraph if there is one, then a sentence, then a space, and
 * only cut a word when a single word is somehow longer than the limit.
 */
export function split(text: string, limit = SMS_LIMIT): string[] {
  const parts: string[] = []
  let rest = text.trim()

  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    const at = [window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf(' ')].find(
      (position) => position > limit * 0.5,
    )

    const cut = at === undefined ? limit : at + (window[at] === '.' ? 1 : 0)
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }

  if (rest) parts.push(rest)
  return parts
}

/**
 * Twilio's send errors, with the ones that do not say what to do spelled out.
 *
 * 21610 is the one that matters most and the one most likely to be read as a
 * bug. It is not: the customer texted STOP, the carrier and Twilio recorded it,
 * and every further message to that number is refused. Retrying is the wrong
 * response and in several countries an unlawful one. The opt-out is theirs to
 * reverse by texting START, and nobody else can do it for them.
 *
 * 21608 catches out every trial account, because a trial may only write to
 * numbers verified in the console, and the error says only that the number is
 * unverified rather than where to verify it.
 */
function explain(error: { code?: number; message?: string }, status: number): string {
  // Twilio's own messages end in a full stop, and every branch below continues
  // the sentence, so keeping it gives "recipient.. A trial account".
  const said = (error.message ?? String(status)).replace(/\.\s*$/, '')

  if (error.code === 21610) {
    return (
      `Twilio send failed: ${said}. This person texted STOP, so they are unsubscribed and Twilio ` +
      'refuses anything further to that number. Do not retry and do not route around it: only they ' +
      'can undo it, by texting START. Treat it as a closed conversation.'
    )
  }

  // What a trial account actually returns, and not what its documentation
  // suggests: the classic 21608 is described as the unverified-recipient error,
  // but a real trial send comes back 422 with this instead, and this code is
  // not in that list at all. Two things are missing at once and the message
  // names only one of them.
  if (error.code === 572002) {
    return (
      `Twilio send failed: ${said}. A trial account can only message numbers added as verified ` +
      'recipients, and it needs a trial phone number of its own to send from. Add the recipient ' +
      'under Phone Numbers > Verified Caller IDs and make sure the account has a number, or ' +
      'upgrade the account.'
    )
  }

  if (error.code === 21608) {
    return (
      `Twilio send failed: ${said}. A trial account may only send to numbers verified in the ` +
      'console, under Phone Numbers > Verified Caller IDs. Add the number there, or upgrade the ' +
      'account.'
    )
  }

  if (error.code === 21606 || error.code === 21611) {
    return (
      `Twilio send failed: ${said}. The From number is not one this account owns, or is not ` +
      'SMS-capable. Check that `from` is a number on this account and that SMS is enabled for it.'
    )
  }

  if (error.code === 21408) {
    return (
      `Twilio send failed: ${said}. Messaging to that country is switched off for this account. ` +
      'Turn it on under Messaging > Settings > Geo permissions, which is off by default for most ' +
      'countries.'
    )
  }

  if (error.code === 21614) {
    return `Twilio send failed: ${said}. That number cannot receive SMS, which usually means a landline.`
  }

  return `Twilio send failed: ${status} ${said}`
}
