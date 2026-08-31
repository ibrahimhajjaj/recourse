import { safeEqual } from '../util/compare.js'
import { answerInBackground, acknowledge, rejected, type ChannelBase, type InboundMessage } from './shared.js'

export interface InboundEmail {
  from: string
  fromName?: string
  subject: string
  text: string
  /** Used to keep a reply on the same thread. */
  messageId?: string
  inReplyTo?: string
  /**
   * Every address the message was sent to, not just the first.
   *
   * A support address is regularly the second name on a reply-all, and a loop
   * check that only reads the first one is a loop check that misses exactly
   * the case it exists for.
   */
  to?: string[]
  /**
   * Whatever headers the provider passes through, lowercased.
   *
   * Only used to work out whether a machine sent this. `parseCommonEmail`
   * fills it in from the shapes Postmark, SendGrid and Mailgun use.
   */
  headers?: Record<string, string>
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
      // No provider signs inbound mail, so this shared secret is all there is.
      if (!safeEqual(presented ?? '', options.secret.value)) return rejected('bad secret')
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

    // Answering a machine is how a mail loop starts, and a mail loop does not
    // stop on its own: two auto-responders can exchange thousands of messages
    // in an afternoon and get the sending domain blacklisted. 200 anyway, so
    // the provider does not retry what was deliberately left alone.
    if (isAutomated(email)) return acknowledge()

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

/**
 * Brevo nests, where the others are flat.
 *
 * One POST can carry several emails under `items`, and the addresses are
 * objects rather than the "Name <address>" strings everybody else sends. This
 * flattens the first one into the shape the rest of the parser reads, so there
 * is one parser rather than two.
 */
function brevo(body: unknown): Record<string, unknown> | null {
  const items = (body as { items?: unknown[] } | null)?.items
  const first = Array.isArray(items) ? (items[0] as Record<string, any> | undefined) : undefined
  if (!first?.From?.Address) return null

  return {
    From: first.From.Address,
    FromName: first.From.Name,
    Subject: first.Subject,
    // The markdown extraction is Brevo's own reply stripping, which is the
    // same job this library does on the other providers' raw bodies, so it is
    // preferred where it exists.
    TextBody: first.ExtractedMarkdownMessage ?? first.RawTextBody,
    MessageID: first.MessageId,
    'In-Reply-To': first.InReplyTo,
    To: (Array.isArray(first.To) ? first.To : [])
      .map((one: { Address?: string }) => one?.Address)
      .filter(Boolean)
      .join(', '),
    Headers: first.Headers,
  }
}

/**
 * Handles the shapes Postmark, SendGrid, Mailgun, Cloudflare and Brevo use.
 *
 * Every one of them invented its own field names for the same six facts. This
 * covers the ones that can be told apart from the body alone; anything else is
 * a `parse` of your own, which is why that option exists.
 */
export function parseCommonEmail(body: unknown): InboundEmail | null {
  const raw = brevo(body) ?? (body as Record<string, unknown>)
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
    to: extractAddresses(pick(raw, ['To', 'to', 'recipient', 'OriginalRecipient']) ?? ''),
    headers: collectHeaders(raw),
  }
}

/**
 * Pulls the headers out of whichever shape the provider chose.
 *
 * Postmark sends an array of `{Name, Value}`, Mailgun the same under a
 * different key with `[name, value]` pairs, SendGrid one newline-delimited
 * string. Cloudflare hands over whatever the Worker chose to forward. All four
 * end up lowercased here so the checks above only have to know one spelling.
 */
function collectHeaders(raw: Record<string, unknown>): Record<string, string> {
  const found: Record<string, string> = {}

  const add = (name: unknown, value: unknown) => {
    if (typeof name === 'string' && typeof value === 'string') found[name.trim().toLowerCase()] = value.trim()
  }

  const list = raw.Headers ?? raw.headers ?? raw['message-headers']
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (Array.isArray(entry)) add(entry[0], entry[1])
      else if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        add(record.Name ?? record.name, record.Value ?? record.value)
      }
    }
  } else if (typeof list === 'string') {
    for (const line of list.split(/\r?\n/)) {
      const at = line.indexOf(':')
      if (at > 0) add(line.slice(0, at), line.slice(at + 1))
    }
  } else if (list && typeof list === 'object') {
    for (const [name, value] of Object.entries(list as Record<string, unknown>)) add(name, value)
  }

  return found
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

/**
 * Splits a recipient header into addresses.
 *
 * Commas inside a quoted display name are not separators, which is why this
 * takes the angle brackets first and only falls back to splitting when a
 * header has none.
 */
function extractAddresses(header: string): string[] | undefined {
  const bracketed = [...header.matchAll(/<([^>]+)>/g)].map((found) => (found[1] as string).trim())
  const found = bracketed.length > 0 ? bracketed : header.split(',').map((part) => part.trim())

  const addresses = found.filter((address) => address.includes('@'))
  return addresses.length > 0 ? addresses : undefined
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

/**
 * Whether a machine sent this, and a reply would therefore be talking to a
 * machine.
 *
 * Every check here is something a sending system sets about itself, which is
 * the only kind that is reliable: an out of office reply announces itself in
 * `Auto-Submitted`, a mailing list in `List-Id`, a bounce in its envelope
 * sender. Guessing from the wording of the body would refuse real customers
 * who happen to write "automatic" in a sentence.
 *
 * The last check is the one that catches the worst case. Mail arriving from
 * the same address it was sent to is the support inbox talking to itself, and
 * that loop runs at machine speed until somebody notices the bill.
 */
export function isAutomated(email: InboundEmail): boolean {
  const headers = email.headers ?? {}

  // RFC 3834. `no` is the explicit "a person wrote this"; anything else is a
  // system announcing that it answered on its own.
  const submitted = headers['auto-submitted']?.trim().toLowerCase()
  if (submitted && submitted !== 'no') return true

  // Microsoft's, and set by Exchange on out of office replies.
  if (headers['x-auto-response-suppress']) return true

  // Bulk and list mail: newsletters, notifications, anything with an
  // unsubscribe link. None of it is a customer asking a question.
  const precedence = headers['precedence']?.trim().toLowerCase()
  if (precedence && ['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) return true
  if (headers['list-id'] || headers['list-unsubscribe']) return true

  // Addresses that exist to send and not to receive. A reply to one of these
  // either bounces or lands somewhere nobody reads.
  const local = email.from.toLowerCase().split('@')[0] ?? ''
  const noReply = ['mailer-daemon', 'postmaster', 'no-reply', 'noreply', 'donotreply', 'do-not-reply', 'bounce', 'bounces']
  if (noReply.includes(local.replace(/[._]/g, '-'))) return true

  const sender = email.from.toLowerCase()
  if (email.to?.some((address) => address.toLowerCase() === sender)) return true

  return false
}
