import { answerInBackground, acknowledge, rejected, type ChannelBase, type InboundMessage } from './shared.js'

export interface InboundEmail {
  from: string
  fromName?: string
  subject: string
  text: string
  /** Used to keep a reply on the same thread. */
  messageId?: string
  inReplyTo?: string
  to?: string
}

export interface EmailOptions extends ChannelBase {
  /**
   * Turns your provider's webhook body into an email. Postmark, SendGrid,
   * Mailgun and Cloudflare Email Routing all disagree about field names, so
   * this is the one thing you have to write. `parseCommonEmail` covers the
   * usual shapes.
   */
  parse?: (body: unknown, request: Request) => InboundEmail | null
  send: (reply: {
    to: string
    subject: string
    text: string
    inReplyTo?: string
  }) => Promise<void>
  /** Shared secret checked against a header, since providers rarely sign. */
  secret?: { header: string; value: string }
}

/**
 * Inbound email.
 *
 * Email is the channel where an unanswered question costs the most, because
 * nobody is watching the inbox at 2am and the customer waits until morning.
 * It is also the easiest to get wrong: reply on the wrong thread and you start
 * a second conversation about the same problem.
 */
export function emailChannel(options: EmailOptions) {
  const parse = options.parse ?? parseCommonEmail

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    if (options.secret) {
      const presented = request.headers.get(options.secret.header)
      if (presented !== options.secret.value) return rejected('bad secret')
    }

    const contentType = request.headers.get('content-type') ?? ''
    let body: unknown

    try {
      if (contentType.includes('application/json')) {
        body = await request.json()
      } else {
        const form: Record<string, string> = {}
        for (const [key, value] of new URLSearchParams(await request.text())) form[key] = value
        body = form
      }
    } catch {
      return acknowledge()
    }

    const email = parse(body, request)
    if (!email?.text.trim() || !email.from) return acknowledge()

    const message: InboundMessage = {
      // Threaded on the sender, so a follow-up lands in the same conversation.
      conversationId: `email:${email.from.toLowerCase()}`,
      text: email.subject ? `${email.subject}\n\n${stripQuoted(email.text)}` : stripQuoted(email.text),
      contact: { id: email.from, email: email.from, name: email.fromName },
      reply: {
        to: email.from,
        subject: email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`,
        inReplyTo: email.messageId ?? '',
      },
    }

    answerInBackground(options, 'email', message, async (text, inbound) => {
      await options.send({
        to: inbound.reply.to as string,
        subject: inbound.reply.subject as string,
        text,
        inReplyTo: inbound.reply.inReplyTo || undefined,
      })
    })

    return acknowledge()
  }
}

/** Handles the field names Postmark, SendGrid, Mailgun and Cloudflare use. */
export function parseCommonEmail(body: unknown): InboundEmail | null {
  const raw = body as Record<string, unknown>
  if (!raw) return null

  const from = pick(raw, ['From', 'from', 'sender', 'FromFull.Email'])
  const text = pick(raw, ['TextBody', 'text', 'body-plain', 'plain', 'stripped-text'])
  const subject = pick(raw, ['Subject', 'subject']) ?? ''
  if (!from || !text) return null

  return {
    // "Sam Fletcher <sam@example.com>" is a valid From; the address is inside.
    from: extractAddress(from),
    fromName: pick(raw, ['FromName', 'FromFull.Name']) ?? extractName(from),
    subject,
    text,
    messageId: pick(raw, ['MessageID', 'Message-Id', 'message-id', 'messageId']),
    inReplyTo: pick(raw, ['In-Reply-To', 'inReplyTo']),
  }
}

function pick(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = key.includes('.')
      ? key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], source)
      : source[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function extractAddress(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1]?.trim() ?? from.trim()
}

function extractName(from: string): string | undefined {
  const name = from.split('<')[0]?.trim().replace(/^"|"$/g, '')
  return name && name !== from.trim() ? name : undefined
}

/**
 * Drops the quoted history below a reply.
 *
 * Left in, every reply re-sends the whole thread to the model, which costs
 * context and makes retrieval match the previous question instead of the new
 * one.
 */
export function stripQuoted(text: string): string {
  const lines = text.split('\n')
  const cut = lines.findIndex((line) =>
    /^\s*(>|On .+ wrote:|-----Original Message-----|From: )/.test(line),
  )
  return (cut === -1 ? lines : lines.slice(0, cut)).join('\n').trim()
}
