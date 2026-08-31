import { acknowledge, answerInBackground, rejected, type ChannelBase, type InboundMessage } from './shared.js'
import { verifyIntercom } from './verify.js'
import { fetchWithRetry } from '../util/http.js'

/**
 * Intercom, answering in their own messenger.
 *
 * Distinct from the `intercom` help desk connector, which opens a ticket and
 * walks away. This one is a conversation: the customer types in the Intercom
 * messenger on your site, the agent answers there, and the thread stays where
 * your team already works.
 *
 * Two things about their webhooks are worth knowing before wiring one up.
 * They sign with SHA-1 in `X-Hub-Signature`, which is the scheme Meta used
 * years ago and Intercom kept. And the reply needs an `admin_id`: an answer
 * has to come from somebody, so a bot needs an admin to be, which is created
 * in Intercom rather than here.
 */

export interface IntercomOptions extends ChannelBase {
  /** From the app's Basic Information page. Verifies every notification. */
  clientSecret: string
  /** An access token for the same app, used to reply. */
  accessToken: string
  /**
   * Which admin the reply comes from.
   *
   * Intercom attributes every admin reply to somebody, so this is not optional
   * the way it looks. Make an admin for the agent and use its id, or replies
   * arrive signed by whichever human you borrowed.
   */
  adminId: string
  /** Data residency. Sending to the wrong one answers 401. */
  region?: 'eu' | 'au'
  /** Their API is versioned by header, and pinning it is the point. */
  version?: string
  /** Skips signature checking. For tests, never for a deployment. */
  insecureSkipVerification?: boolean
  send?: (conversationId: string, text: string) => Promise<void>
}

interface Notification {
  topic?: string
  data?: {
    item?: {
      id?: string
      source?: { body?: string; author?: Author }
      conversation_parts?: { conversation_parts?: Array<{ body?: string; author?: Author }> }
    }
  }
}

interface Author {
  type?: string
  id?: string
  name?: string
  email?: string
}

const ANSWERED = new Set(['conversation.user.created', 'conversation.user.replied'])

export function intercomChannel(options: IntercomOptions) {
  const host =
    options.region === 'eu' ? 'api.eu.intercom.io' : options.region === 'au' ? 'api.au.intercom.io' : 'api.intercom.io'

  const send =
    options.send ??
    (async (conversationId: string, text: string) => {
      const response = await fetchWithRetry(
        `https://${host}/conversations/${encodeURIComponent(conversationId)}/reply`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.accessToken}`,
            'Content-Type': 'application/json',
            // Pinned, because an unpinned version moves under you and their
            // shapes have changed between versions before.
            'Intercom-Version': options.version ?? '2.11',
          },
          body: JSON.stringify({
            message_type: 'comment',
            type: 'admin',
            admin_id: options.adminId,
            body: text,
          }),
        },
        { attempts: 3 },
      )

      if (!response.ok) {
        throw new Error(`Intercom reply failed: ${response.status} ${await response.text()}`)
      }
    })

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    // Read as text and verified before parsing. Parsing first would mean
    // checking a signature over something the sender never sent.
    const rawBody = await request.text()

    if (!options.insecureSkipVerification) {
      const signed = await verifyIntercom(rawBody, request.headers.get('x-hub-signature'), options.clientSecret)
      if (!signed) return rejected('bad signature')
    }

    let body: Notification
    try {
      body = JSON.parse(rawBody) as Notification
    } catch {
      return acknowledge()
    }

    const message = extract(body)
    if (message) {
      answerInBackground(options, 'intercom', message, async (text, inbound) => {
        await send(inbound.reply.conversationId as string, text)
      })
    }

    // Always, and quickly. Intercom retries what it cannot deliver, so a slow
    // answer earns the customer the same reply several times over.
    return acknowledge()
  }
}

function extract(body: Notification): InboundMessage | null {
  if (!ANSWERED.has(body.topic ?? '')) return null

  const item = body.data?.item
  const conversationId = item?.id
  if (!conversationId) return null

  // A new conversation carries its first message in `source`. A reply carries
  // it as the newest conversation part, and the parts include the agent's own
  // replies, so the author has to be checked or it answers itself.
  const parts = item.conversation_parts?.conversation_parts ?? []
  const latest = parts.length > 0 ? parts[parts.length - 1] : undefined
  const from = latest ?? item.source
  const author = from?.author

  if (author?.type !== 'user' && author?.type !== 'lead' && author?.type !== 'contact') return null

  // Bodies are HTML, because the messenger is a rich text box.
  const text = stripHtml(from?.body ?? '')
  if (!text) return null

  return {
    conversationId: `intercom:${conversationId}`,
    text,
    contact: author.id
      ? { id: author.id, ...(author.name ? { name: author.name } : {}), ...(author.email ? { email: author.email } : {}) }
      : undefined,
    reply: { conversationId, channel: 'intercom' },
  }
}

/**
 * The message a person typed, out of the markup the messenger wrapped it in.
 *
 * Block elements become line breaks first, or two paragraphs run into one
 * word. Entities are decoded last so a decoded `&lt;b&gt;` cannot be mistaken
 * for a tag that was never there.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
