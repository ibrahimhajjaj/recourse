import type { EscalationRequest } from '../actions/builtin/escalate.js'
import type { ActionContext } from '../actions/types.js'
import { fetchWithRetry } from '../util/http.js'

/**
 * Ready-made destinations for `escalate`.
 *
 * The action already takes a `createTicket` callback and says any help desk
 * works, which is true and is not the same as useful: it leaves everybody
 * writing the same forty lines against the same nine APIs. These are those
 * forty lines, written once.
 *
 * Each one is a function returning a `createTicket`, so the call site reads the
 * same whichever desk is behind it:
 *
 *   escalate({ createTicket: zendesk({ subdomain, email, apiToken }) })
 *
 * All of them are shaped from the vendor's own published request, and none has
 * been run against a live account. `CHANNELS-VERIFIED.md` keeps that
 * distinction for the channels and it applies here too.
 */

export type CreateTicket = (
  ticket: EscalationRequest,
  ctx: ActionContext,
) => Promise<{ id?: string } | void>

/** What every desk gets told, assembled once rather than nine times. */
function describe(ticket: EscalationRequest): string {
  const parts = [ticket.body]
  if (ticket.transcript) parts.push('', 'Conversation so far:', ticket.transcript)
  return parts.join('\n')
}

const ZOHO_PRIORITY: Record<'low' | 'normal' | 'high' | 'urgent', string> = {
  low: 'Low',
  normal: 'Medium',
  high: 'High',
  urgent: 'High',
}

async function send(url: string, init: RequestInit, desk: string): Promise<any> {
  // Retried, because the alternative is a customer told their ticket was raised
  // when a rate limit or a five-second wobble meant it never was. Only where
  // the desk certainly did not act on it: none of these APIs take an
  // idempotency key, so repeating a create through a gateway timeout that
  // happened after the write leaves the customer with two tickets and an agent
  // answering both.
  const response = await fetchWithRetry(url, init, { attempts: 3, onlyIfUntouched: true })
  const text = await response.text()

  if (!response.ok) {
    // The body explains what the status will not, and it is the only way to
    // find out that a field was wrong. It goes to the log rather than up the
    // stack: this message becomes tool output, which the model is told to
    // relay, and an Odoo fault carries a traceback with the database name and
    // the paths on the server in it.
    console.error(`[helpdeck] ${desk} ticket failed: ${response.status} ${text.slice(0, 400)}`)
    throw new Error(`${desk} ticket failed: ${response.status}`)
  }

  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export interface ZendeskOptions {
  /** The bit before `.zendesk.com`. */
  subdomain: string
  /**
   * An OAuth access token, which is the way Zendesk wants this done.
   *
   * Zendesk is retiring API tokens: existing ones stop working on 30 April
   * 2027, and accounts created after the announcement have no button to make
   * one, so this is the only route available on a new account.
   */
  accessToken?: string
  /** The agent email the API token belongs to. Not needed with a token. */
  email?: string
  /** Deprecated by Zendesk rather than by us. Use `accessToken` on anything new. */
  apiToken?: string
}

/**
 * Zendesk.
 *
 * Two ways in, because Zendesk changed its mind about the first one. With an
 * OAuth access token it is a bearer header like everything else. With an API
 * token it is basic auth, and the username is `{email}/token` rather than the
 * email, which answers 401 with nothing to say about why when you get it
 * wrong.
 */
export function zendesk(options: ZendeskOptions): CreateTicket {
  if (!options.accessToken && !(options.email && options.apiToken)) {
    throw new Error('zendesk needs either an accessToken or both an email and an apiToken')
  }

  const authorization = options.accessToken
    ? `Bearer ${options.accessToken}`
    : `Basic ${btoa(`${options.email}/token:${options.apiToken}`)}`

  return async (ticket) => {
    const body = await send(
      `https://${options.subdomain}.zendesk.com/api/v2/tickets.json`,
      {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket: {
            subject: ticket.subject,
            comment: { body: describe(ticket) },
            ...(ticket.priority ? { priority: ticket.priority } : {}),
            ...(ticket.email ? { requester: { name: ticket.name ?? ticket.email, email: ticket.email } } : {}),
          },
        }),
      },
      'Zendesk',
    )

    return { id: body?.ticket?.id ? String(body.ticket.id) : undefined }
  }
}

export interface FreshdeskOptions {
  /** The bit before `.freshdesk.com`. */
  domain: string
  apiKey: string
}

/**
 * Freshdesk.
 *
 * Basic auth with the API key as the username and any character as the
 * password, which is their instruction and not a shortcut. `status` 2 is open
 * and `priority` is a number, so the named priorities are mapped rather than
 * passed through.
 */
export function freshdesk(options: FreshdeskOptions): CreateTicket {
  const auth = btoa(`${options.apiKey}:X`)
  const priorities = { low: 1, normal: 2, high: 3, urgent: 4 } as const

  return async (ticket) => {
    // Freshdesk needs somebody to attribute the ticket to, and an email is the
    // only identifier this library is sure to have.
    if (!ticket.email) throw new Error('Freshdesk needs an email address to open a ticket against')

    const body = await send(
      `https://${options.domain}.freshdesk.com/api/v2/tickets`,
      {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: ticket.subject,
          description: describe(ticket),
          email: ticket.email,
          ...(ticket.name ? { name: ticket.name } : {}),
          priority: priorities[ticket.priority ?? 'normal'],
          status: 2,
        }),
      },
      'Freshdesk',
    )

    return { id: body?.id ? String(body.id) : undefined }
  }
}

export interface IntercomOptions {
  accessToken: string
  /** From Settings, Ticket types. Intercom refuses a ticket without one. */
  ticketTypeId: string | number
  /** Their API is versioned by header, and the default moves. */
  version?: string
  /** Intercom attaches tickets to a contact, so one is found or created. */
  region?: 'us' | 'eu' | 'au'
}

/**
 * Intercom.
 *
 * The only one here that will not take an email address on the ticket itself.
 * A ticket belongs to a contact, so the contact has to exist first, which is
 * two calls rather than one and is the part that catches people out.
 */
export function intercom(options: IntercomOptions): CreateTicket {
  const host =
    options.region === 'eu' ? 'api.eu.intercom.io' : options.region === 'au' ? 'api.au.intercom.io' : 'api.intercom.io'

  const headers = {
    Authorization: `Bearer ${options.accessToken}`,
    'Content-Type': 'application/json',
    'Intercom-Version': options.version ?? '2.16',
  }

  return async (ticket) => {
    if (!ticket.email) throw new Error('Intercom needs an email address to attach the ticket to a contact')

    // Search first: creating a contact that already exists is a 409, and a
    // duplicate contact is worse than the extra call.
    const found = await send(
      `https://${host}/contacts/search`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: { field: 'email', operator: '=', value: ticket.email } }),
      },
      'Intercom',
    )

    let contactId: string | undefined = found?.data?.[0]?.id

    if (!contactId) {
      const created = await send(
        `https://${host}/contacts`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ role: 'user', email: ticket.email, ...(ticket.name ? { name: ticket.name } : {}) }),
        },
        'Intercom',
      )
      contactId = created?.id
    }

    const body = await send(
      `https://${host}/tickets`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ticket_type_id: options.ticketTypeId,
          contacts: [{ id: contactId }],
          ticket_attributes: {
            _default_title_: ticket.subject,
            _default_description_: describe(ticket),
          },
        }),
      },
      'Intercom',
    )

    return { id: body?.id ? String(body.id) : undefined }
  }
}

export interface HelpScoutOptions {
  accessToken: string
  /** Which mailbox the conversation lands in. */
  mailboxId: number
}

/**
 * Help Scout.
 *
 * A conversation rather than a ticket, and it needs at least one thread in the
 * same call or it is created empty and nobody sees it.
 */
export function helpScout(options: HelpScoutOptions): CreateTicket {
  return async (ticket) => {
    if (!ticket.email) throw new Error('Help Scout needs an email address for the customer')

    const body = await send(
      'https://api.helpscout.net/v2/conversations',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: ticket.subject,
          type: 'email',
          mailboxId: options.mailboxId,
          status: 'active',
          customer: { email: ticket.email, ...(ticket.name ? { firstName: ticket.name } : {}) },
          threads: [{ type: 'customer', customer: { email: ticket.email }, text: describe(ticket) }],
        }),
      },
      'Help Scout',
    )

    return { id: body?.id ? String(body.id) : undefined }
  }
}

export interface ZohoDeskOptions {
  accessToken: string
  orgId: string
  departmentId: string
  /** Zoho's data centre. `.com`, `.eu`, `.in` and so on. */
  domain?: string
}

/** Zoho Desk. The org id is a header, and it is not optional. */
export function zohoDesk(options: ZohoDeskOptions): CreateTicket {
  const domain = options.domain ?? 'com'

  return async (ticket) => {
    const body = await send(
      `https://desk.zoho.${domain}/api/v1/tickets`,
      {
        method: 'POST',
        headers: {
          Authorization: `Zoho-oauthtoken ${options.accessToken}`,
          orgId: options.orgId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: ticket.subject,
          description: describe(ticket),
          departmentId: options.departmentId,
          ...(ticket.email ? { email: ticket.email } : {}),
          // Zoho's picklist is High, Medium and Low, so `normal` and the
          // lower-case spellings are not values it has and are dropped
          // silently when sent.
          ...(ticket.priority ? { priority: ZOHO_PRIORITY[ticket.priority] } : {}),
        }),
      },
      'Zoho Desk',
    )

    return { id: body?.id ? String(body.id) : undefined }
  }
}

export interface HubSpotOptions {
  accessToken: string
  /** The pipeline and stage a new ticket starts in. */
  pipeline?: string
  pipelineStage?: string
}

/**
 * HubSpot.
 *
 * Tickets are CRM objects, so the fields are properties and the names are
 * HubSpot's own: `subject`, `content`, `hs_pipeline`.
 */
export function hubspot(options: HubSpotOptions): CreateTicket {
  return async (ticket) => {
    const body = await send(
      'https://api.hubapi.com/crm/v3/objects/tickets',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          properties: {
            subject: ticket.subject,
            content: describe(ticket),
            hs_pipeline: options.pipeline ?? '0',
            hs_pipeline_stage: options.pipelineStage ?? '1',
            ...(ticket.priority === 'urgent' || ticket.priority === 'high' ? { hs_ticket_priority: 'HIGH' } : {}),
          },
        }),
      },
      'HubSpot',
    )

    return { id: body?.id ? String(body.id) : undefined }
  }
}

export interface GorgiasOptions {
  /** The bit before `.gorgias.com`. */
  domain: string
  /** The email the API key belongs to. */
  email: string
  apiKey: string
}

/**
 * Gorgias.
 *
 * A ticket is its messages, and each message repeats the sender and receiver.
 * Leaving `from_agent` off makes the customer's own words look like the shop's.
 */
export function gorgias(options: GorgiasOptions): CreateTicket {
  const auth = btoa(`${options.email}:${options.apiKey}`)

  return async (ticket) => {
    if (!ticket.email) throw new Error('Gorgias needs an email address for the customer')

    const customer = { email: ticket.email, ...(ticket.name ? { name: ticket.name } : {}) }

    const body = await send(
      `https://${options.domain}.gorgias.com/api/tickets`,
      {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: ticket.subject,
          customer,
          channel: 'chat',
          via: 'chat',
          messages: [
            {
              channel: 'chat',
              via: 'chat',
              from_agent: false,
              sender: customer,
              body_text: describe(ticket),
            },
          ],
        }),
      },
      'Gorgias',
    )

    return { id: body?.id ? String(body.id) : undefined }
  }
}

export interface SalesforceOptions {
  /** Your My Domain instance URL, without a trailing slash. */
  instanceUrl: string
  accessToken: string
  apiVersion?: string
}

/** Salesforce. A support ticket is a Case, and the fields are named for that. */
export function salesforce(options: SalesforceOptions): CreateTicket {
  const version = options.apiVersion ?? 'v62.0'

  return async (ticket) => {
    const body = await send(
      `${options.instanceUrl.replace(/\/$/, '')}/services/data/${version}/sobjects/Case`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Subject: ticket.subject,
          Description: describe(ticket),
          Origin: 'Chat',
          ...(ticket.email ? { SuppliedEmail: ticket.email } : {}),
          ...(ticket.name ? { SuppliedName: ticket.name } : {}),
          ...(ticket.priority === 'urgent' || ticket.priority === 'high' ? { Priority: 'High' } : {}),
        }),
      },
      'Salesforce',
    )

    return { id: body?.id ? String(body.id) : undefined }
  }
}

export interface OdooOptions {
  /** Your Odoo instance URL, without a trailing slash. */
  url: string
  database: string
  /** The numeric user id, which is what Odoo's JSON-RPC wants, not the login. */
  userId: number
  apiKey: string
  /** Defaults to the Helpdesk module's ticket model. */
  model?: string
}

/**
 * Odoo Helpdesk.
 *
 * The odd one out: JSON-RPC rather than REST, so everything is a POST to the
 * same path and the method name travels in the body.
 */
export function odoo(options: OdooOptions): CreateTicket {
  return async (ticket) => {
    const body = await send(
      `${options.url.replace(/\/$/, '')}/jsonrpc`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'call',
          params: {
            service: 'object',
            method: 'execute_kw',
            args: [
              options.database,
              options.userId,
              options.apiKey,
              options.model ?? 'helpdesk.ticket',
              'create',
              [
                {
                  name: ticket.subject,
                  description: describe(ticket),
                  ...(ticket.email ? { partner_email: ticket.email } : {}),
                  ...(ticket.name ? { partner_name: ticket.name } : {}),
                },
              ],
            ],
          },
          id: Date.now(),
        }),
      },
      'Odoo',
    )

    // JSON-RPC answers 200 for a failure and puts the reason in `error`, so the
    // status check above never fires and this is the only place it shows.
    if (body?.error) {
      throw new Error(`Odoo ticket failed: ${JSON.stringify(body.error).slice(0, 400)}`)
    }

    return { id: body?.result ? String(body.result) : undefined }
  }
}
