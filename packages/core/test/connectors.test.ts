import { describe, expect, it, vi } from 'vitest'
import {
  freshdesk,
  gorgias,
  helpScout,
  hubspot,
  intercom,
  odoo,
  salesforce,
  zendesk,
  zohoDesk,
} from '../src/helpdesk/connectors.js'
import type { ActionContext } from '../src/actions/types.js'

const ticket = {
  subject: 'Refund not received',
  body: 'Ordered on the 3rd, refunded on the 9th, nothing has arrived.',
  email: 'sam@example.com',
  name: 'Sam Fletcher',
  priority: 'high' as const,
  conversationId: 'c1',
  transcript: 'customer: where is my refund?\nagent: let me open a ticket.',
}

const ctx = {} as ActionContext

/** Records what each vendor would actually receive. */
function recorder(responses: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; method?: string; headers: Record<string, string>; body: any }> = []

  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    )
    let body: any = undefined
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined
    } catch {
      body = String(init?.body)
    }
    calls.push({ url, method: init?.method, headers, body })

    const match = Object.keys(responses).find((key) => url.includes(key))
    return new Response(JSON.stringify(match ? responses[match] : { id: 4242 }), { status: 200 })
  })

  return { calls, restore: () => spy.mockRestore() }
}

/** Base64 is how five of these authenticate, and the username half varies. */
function decodeBasic(header: string): string {
  return atob(header.replace(/^Basic\s+/i, ''))
}

describe('Zendesk', () => {
  it('sends the ticket in the envelope Zendesk documents', async () => {
    const { calls, restore } = recorder({ 'zendesk.com': { ticket: { id: 91 } } })
    const id = await zendesk({ subdomain: 'lumen', email: 'ada@lumen.co', apiToken: 'tok' })(ticket, ctx)
    restore()

    expect(calls[0]?.url).toBe('https://lumen.zendesk.com/api/v2/tickets.json')
    expect(calls[0]?.body.ticket.subject).toBe('Refund not received')
    expect(calls[0]?.body.ticket.comment.body).toContain('nothing has arrived')
    expect(calls[0]?.body.ticket.requester).toEqual({ name: 'Sam Fletcher', email: 'sam@example.com' })
    expect(id).toEqual({ id: '91' })
  })

  it('authenticates as {email}/token, which is the part that catches people out', async () => {
    const { calls, restore } = recorder()
    await zendesk({ subdomain: 'lumen', email: 'ada@lumen.co', apiToken: 'tok' })(ticket, ctx)
    restore()
    expect(decodeBasic(calls[0]!.headers.authorization!)).toBe('ada@lumen.co/token:tok')
  })
})

describe('Freshdesk', () => {
  it('maps the named priority to the number Freshdesk wants', async () => {
    const { calls, restore } = recorder()
    await freshdesk({ domain: 'lumen', apiKey: 'key' })(ticket, ctx)
    restore()

    expect(calls[0]?.url).toBe('https://lumen.freshdesk.com/api/v2/tickets')
    expect(calls[0]?.body.priority).toBe(3)
    expect(calls[0]?.body.status).toBe(2)
    // The API key is the username and the password is a throwaway character.
    expect(decodeBasic(calls[0]!.headers.authorization!)).toBe('key:X')
  })

  it('refuses rather than opening a ticket against nobody', async () => {
    const { restore } = recorder()
    await expect(freshdesk({ domain: 'lumen', apiKey: 'key' })({ ...ticket, email: undefined }, ctx)).rejects.toThrow(
      /email address/,
    )
    restore()
  })
})

describe('Intercom', () => {
  it('finds the contact before opening the ticket, rather than duplicating them', async () => {
    const { calls, restore } = recorder({
      '/contacts/search': { data: [{ id: 'contact-1' }] },
      '/tickets': { id: 'ticket-1' },
    })
    const id = await intercom({ accessToken: 'tok', ticketTypeId: 88 })(ticket, ctx)
    restore()

    expect(calls.map((c) => c.url)).toEqual(['https://api.intercom.io/contacts/search', 'https://api.intercom.io/tickets'])
    expect(calls[1]?.body.ticket_type_id).toBe(88)
    expect(calls[1]?.body.contacts).toEqual([{ id: 'contact-1' }])
    expect(calls[1]?.body.ticket_attributes._default_title_).toBe('Refund not received')
    expect(id).toEqual({ id: 'ticket-1' })
  })

  it('creates the contact when the search finds none', async () => {
    const { calls, restore } = recorder({
      '/contacts/search': { data: [] },
      '/contacts': { id: 'new-contact' },
      '/tickets': { id: 'ticket-2' },
    })
    await intercom({ accessToken: 'tok', ticketTypeId: 88 })(ticket, ctx)
    restore()

    expect(calls).toHaveLength(3)
    expect(calls[1]?.body).toEqual({ role: 'user', email: 'sam@example.com', name: 'Sam Fletcher' })
    expect(calls[2]?.body.contacts).toEqual([{ id: 'new-contact' }])
  })

  it('uses the regional host when asked, because the tokens are not portable', async () => {
    const { calls, restore } = recorder({ '/contacts/search': { data: [{ id: 'c' }] } })
    await intercom({ accessToken: 'tok', ticketTypeId: 1, region: 'eu' })(ticket, ctx)
    restore()
    expect(calls[0]?.url.startsWith('https://api.eu.intercom.io/')).toBe(true)
  })
})

describe('Help Scout', () => {
  it('creates the conversation with a thread, or nobody would see it', async () => {
    const { calls, restore } = recorder()
    await helpScout({ accessToken: 'tok', mailboxId: 7 })(ticket, ctx)
    restore()

    expect(calls[0]?.url).toBe('https://api.helpscout.net/v2/conversations')
    expect(calls[0]?.body.mailboxId).toBe(7)
    expect(calls[0]?.body.threads).toHaveLength(1)
    expect(calls[0]?.body.threads[0].type).toBe('customer')
  })
})

describe('Zoho Desk', () => {
  it('sends the org id as a header and honours the data centre', async () => {
    const { calls, restore } = recorder()
    await zohoDesk({ accessToken: 'tok', orgId: '123', departmentId: '456', domain: 'eu' })(ticket, ctx)
    restore()

    expect(calls[0]?.url).toBe('https://desk.zoho.eu/api/v1/tickets')
    expect(calls[0]?.headers.orgid).toBe('123')
    expect(calls[0]?.headers.authorization).toBe('Zoho-oauthtoken tok')
    expect(calls[0]?.body.departmentId).toBe('456')
  })
})

describe('HubSpot', () => {
  it('sends the ticket as CRM properties under HubSpot names', async () => {
    const { calls, restore } = recorder()
    await hubspot({ accessToken: 'tok' })(ticket, ctx)
    restore()

    expect(calls[0]?.url).toBe('https://api.hubapi.com/crm/v3/objects/tickets')
    expect(calls[0]?.body.properties.subject).toBe('Refund not received')
    expect(calls[0]?.body.properties.content).toContain('nothing has arrived')
    expect(calls[0]?.body.properties.hs_ticket_priority).toBe('HIGH')
  })
})

describe('Gorgias', () => {
  it('marks the message as the customer, not the shop', async () => {
    const { calls, restore } = recorder()
    await gorgias({ domain: 'lumen', email: 'ada@lumen.co', apiKey: 'key' })(ticket, ctx)
    restore()

    expect(calls[0]?.url).toBe('https://lumen.gorgias.com/api/tickets')
    expect(calls[0]?.body.messages[0].from_agent).toBe(false)
    expect(calls[0]?.body.messages[0].sender.email).toBe('sam@example.com')
  })
})

describe('Salesforce', () => {
  it('opens a Case, with Salesforce field names', async () => {
    const { calls, restore } = recorder()
    await salesforce({ instanceUrl: 'https://lumen.my.salesforce.com/', accessToken: 'tok' })(ticket, ctx)
    restore()

    expect(calls[0]?.url).toBe('https://lumen.my.salesforce.com/services/data/v62.0/sobjects/Case')
    expect(calls[0]?.body.Subject).toBe('Refund not received')
    expect(calls[0]?.body.SuppliedEmail).toBe('sam@example.com')
    expect(calls[0]?.body.Priority).toBe('High')
  })
})

describe('Odoo', () => {
  it('speaks JSON-RPC rather than REST', async () => {
    const { calls, restore } = recorder({ '/jsonrpc': { result: 55 } })
    const id = await odoo({ url: 'https://lumen.odoo.com', database: 'lumen', userId: 2, apiKey: 'key' })(ticket, ctx)
    restore()

    expect(calls[0]?.url).toBe('https://lumen.odoo.com/jsonrpc')
    expect(calls[0]?.body.params.method).toBe('execute_kw')
    expect(calls[0]?.body.params.args[3]).toBe('helpdesk.ticket')
    expect(calls[0]?.body.params.args[5][0].name).toBe('Refund not received')
    expect(id).toEqual({ id: '55' })
  })

  it('notices a failure that arrives as a 200', async () => {
    // JSON-RPC answers 200 for an error and puts the reason in the body, so the
    // status check every other connector relies on never fires here.
    const { restore } = recorder({ '/jsonrpc': { error: { message: 'Access Denied' } } })
    await expect(
      odoo({ url: 'https://lumen.odoo.com', database: 'lumen', userId: 2, apiKey: 'key' })(ticket, ctx),
    ).rejects.toThrow(/Access Denied/)
    restore()
  })
})

describe('every connector', () => {
  it('carries the transcript, so nobody has to ask the customer again', async () => {
    const each: Array<[string, () => Promise<unknown>]> = [
      ['zendesk', () => zendesk({ subdomain: 'l', email: 'a@b.co', apiToken: 't' })(ticket, ctx)],
      ['freshdesk', () => freshdesk({ domain: 'l', apiKey: 'k' })(ticket, ctx)],
      ['helpScout', () => helpScout({ accessToken: 't', mailboxId: 1 })(ticket, ctx)],
      ['zohoDesk', () => zohoDesk({ accessToken: 't', orgId: '1', departmentId: '2' })(ticket, ctx)],
      ['hubspot', () => hubspot({ accessToken: 't' })(ticket, ctx)],
      ['gorgias', () => gorgias({ domain: 'l', email: 'a@b.co', apiKey: 'k' })(ticket, ctx)],
      ['salesforce', () => salesforce({ instanceUrl: 'https://x', accessToken: 't' })(ticket, ctx)],
      ['odoo', () => odoo({ url: 'https://x', database: 'd', userId: 1, apiKey: 'k' })(ticket, ctx)],
    ]

    for (const [name, run] of each) {
      const { calls, restore } = recorder()
      await run()
      restore()
      const sent = JSON.stringify(calls[0]?.body)
      expect(sent, name).toContain('where is my refund?')
    }
  })

  it('authenticates with a bearer token when given one', async () => {
    // The way Zendesk wants it done. API tokens stop working on 30 April 2027
    // and a new account has no button to create one, so basic auth is not a
    // route anybody can still take.
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 7 } }), { status: 201 }),
    )

    await zendesk({ subdomain: 'l', accessToken: 'oauth-abc' })(ticket, ctx)

    const sent = spy.mock.calls[0]?.[1] as RequestInit
    expect((sent.headers as Record<string, string>).Authorization).toBe('Bearer oauth-abc')
    spy.mockRestore()
  })

  it('still takes the older email and api token pair', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 8 } }), { status: 201 }),
    )

    await zendesk({ subdomain: 'l', email: 'a@b.co', apiToken: 't' })(ticket, ctx)

    const sent = spy.mock.calls[0]?.[1] as RequestInit
    expect((sent.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('a@b.co/token:t')}`)
    spy.mockRestore()
  })

  it('refuses to be built with neither', () => {
    // Half-configured, it would send an Authorization header of the word
    // "Basic" and a base64 "undefined/token:undefined", and the 401 would be
    // read as bad credentials rather than as missing ones.
    expect(() => zendesk({ subdomain: 'l' })).toThrow(/accessToken|apiToken/)
  })

  it('logs why a desk refused, and tells the model only the status', async () => {
    // The body is the only thing that explains a 422, so an operator needs it.
    // The thrown message is different: it becomes the tool result, the model is
    // told to say plainly what did not work, and an Odoo fault carries a
    // traceback with the database name and the server's paths in it.
    const logged: string[] = []
    const error = vi.spyOn(console, 'error').mockImplementation((m) => void logged.push(String(m)))
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"errors":[{"detail":"Subject is required"}]}', { status: 422 }))

    await expect(zendesk({ subdomain: 'l', email: 'a@b.co', apiToken: 't' })(ticket, ctx)).rejects.toThrow(
      /Zendesk ticket failed: 422$/,
    )
    expect(logged.join(' ')).toContain('Subject is required')

    spy.mockRestore()
    error.mockRestore()
  })

  it('does not repeat a create that may already have been made', async () => {
    // A 502 can arrive after the ticket was written. Repeating it then leaves
    // the customer with two tickets and an agent answering both, and none of
    // these desks takes an idempotency key to sort it out afterwards.
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream', { status: 502 }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(zendesk({ subdomain: 'l', email: 'a@b.co', apiToken: 't' })(ticket, ctx)).rejects.toThrow()
    expect(spy).toHaveBeenCalledTimes(1)

    spy.mockRestore()
    error.mockRestore()
  })

  it('still retries where the desk plainly did not take it', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('slow down', { status: 429 }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(zendesk({ subdomain: 'l', email: 'a@b.co', apiToken: 't' })(ticket, ctx)).rejects.toThrow()
    expect(spy.mock.calls.length).toBeGreaterThan(1)

    spy.mockRestore()
    error.mockRestore()
  })
})
