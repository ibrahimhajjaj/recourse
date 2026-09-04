import type { Document, Source } from '../types.js'

/**
 * A resolved ticket, in the shape any desk can be reduced to.
 *
 * Not a vendor's schema. Nine desks describe the same three things in nine
 * ways, and the part worth indexing is the same in all of them: what was
 * asked, what was answered, and enough of an id to trace it back.
 */
export interface ResolvedTicket {
  id: string | number
  subject: string
  /** What the customer asked, in their words. */
  question: string
  /** What resolved it. A ticket with no answer teaches nothing. */
  answer: string
  /** Shown as the citation link, when the desk has a page for it. */
  url?: string
}

export interface TicketSourceOptions {
  /** Fetches the resolved tickets. One page or all of them; this only reads. */
  load: (signal?: AbortSignal) => Promise<ResolvedTicket[]>
  /** Groups them under one title in citations. */
  title?: string
}

/**
 * Past tickets as knowledge.
 *
 * A support desk that has been running for a year is the best-written
 * documentation a business has and the least likely to exist as a document:
 * the answer to "does the two year warranty cover the charger" was typed by
 * somebody who knew, six times, and lives only in a ticket.
 *
 * Two things make this go wrong, and both are handled by taking a narrow
 * shape rather than a whole export. Only resolved tickets, because an open one
 * is a question with no answer and indexing it teaches the agent to repeat the
 * question. And only the question and the resolution, never the whole thread,
 * because a transcript is mostly scheduling and apology, and a customer's own
 * address and order number have no business in a knowledge base every other
 * customer's questions are answered from.
 *
 * ```ts
 * ticketSource({ load: () => zendeskTickets({ subdomain, accessToken }) })
 * ```
 */
export function ticketSource(options: TicketSourceOptions): Source {
  const title = options.title ?? 'Answers from past tickets'

  return {
    name: 'tickets',
    async load(ctx) {
      const tickets = await options.load(ctx?.signal)

      return tickets
        .filter((ticket) => ticket.question.trim() && ticket.answer.trim())
        .map(
          (ticket): Document => ({
            id: `ticket:${ticket.id}`,
            title,
            url: ticket.url,
            // The subject as the heading, because it is the one line somebody
            // wrote to describe the whole thing, and headings carry weight.
            text: `# ${ticket.subject || ticket.question}\n\nAsked: ${ticket.question}\n\nAnswered: ${ticket.answer}`,
          }),
        )
    },
  }
}

export interface ZendeskTicketOptions {
  /** The bit before `.zendesk.com`. */
  subdomain: string
  /** An OAuth access token. Zendesk is retiring API tokens. */
  accessToken?: string
  /** The agent email an API token belongs to. Not needed with a token. */
  email?: string
  apiToken?: string
  /** How many to read. Zendesk pages at 100, so this is pages times a hundred. */
  limit?: number
  /** Stops a long read when the build is cancelled. */
  signal?: AbortSignal
}

/**
 * Resolved Zendesk tickets, reduced to a question and an answer.
 *
 * The question is the ticket's first comment and the answer is its last public
 * one. Not the whole thread: the middle of a ticket is scheduling, and the last
 * public comment is the one that ended it.
 *
 * Public only. An internal note is written between colleagues about a customer,
 * and it is exactly the sentence you would not want repeated back to the next
 * one.
 *
 * Shaped from Zendesk's published search and comments endpoints. It has not
 * been run against a live account, which `CHANNELS-VERIFIED.md` is the record
 * of for everything else here.
 */
export async function zendeskTickets(options: ZendeskTicketOptions): Promise<ResolvedTicket[]> {
  if (!options.accessToken && !(options.email && options.apiToken)) {
    throw new Error('zendeskTickets needs an accessToken, or an email and apiToken')
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  headers.Authorization = options.accessToken
    ? `Bearer ${options.accessToken}`
    : `Basic ${btoa(`${options.email}/token:${options.apiToken}`)}`

  const base = `https://${encodeURIComponent(options.subdomain)}.zendesk.com/api/v2`
  const wanted = options.limit ?? 200
  const found: ResolvedTicket[] = []

  // Search rather than a list, because the list has no notion of solved and
  // pulling every ticket to throw most of them away is somebody's rate limit.
  let next: string | null = `${base}/search.json?query=${encodeURIComponent('type:ticket status:solved')}&per_page=100`

  while (next && found.length < wanted) {
    const page: Response = await fetch(next, { headers, ...(options.signal ? { signal: options.signal } : {}) })
    if (!page.ok) throw new Error(`Zendesk search failed: ${page.status} ${(await page.text()).slice(0, 200)}`)

    const body = (await page.json()) as {
      results?: Array<{ id?: number; subject?: string; description?: string }>
      next_page?: string | null
    }

    for (const ticket of body.results ?? []) {
      if (found.length >= wanted) break
      if (typeof ticket.id !== 'number') continue

      const answer = await lastPublicReply(base, headers, ticket.id, options.signal)
      if (!answer) continue

      found.push({
        id: ticket.id,
        subject: ticket.subject ?? '',
        question: (ticket.description ?? '').trim(),
        answer,
        url: `https://${options.subdomain}.zendesk.com/agent/tickets/${ticket.id}`,
      })
    }

    next = body.next_page ?? null
  }

  return found
}

/** The last thing an agent said in public on a ticket. */
async function lastPublicReply(
  base: string,
  headers: Record<string, string>,
  id: number,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${base}/tickets/${id}/comments.json`, {
    headers,
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) return ''

  const body = (await response.json()) as {
    comments?: Array<{ body?: string; public?: boolean }>
  }

  const publicComments = (body.comments ?? []).filter((comment) => comment.public !== false)
  // The first is the customer's own question, which is already the question.
  return (publicComments.length > 1 ? (publicComments[publicComments.length - 1]?.body ?? '') : '').trim()
}
