import { describe, expect, it, vi } from 'vitest'
import {
  customButton,
  customForm,
  formSchema,
  scheduleMeeting,
  shopifyOrders,
  slackNotify,
  stripeBilling,
} from '../src/actions/index.js'
import type { StreamFrame } from '../src/types.js'

function ctx() {
  const frames: StreamFrame[] = []
  return { frames, emit: (frame: StreamFrame) => frames.push(frame), conversationId: 'c1' }
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init),
  ) as unknown as typeof fetch
}

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

describe('custom buttons', () => {
  const action = customButton({
    whenToUse: 'x',
    buttons: [
      { label: 'Track my order', url: 'https://shop.example/track' },
      { label: 'Start a return', url: 'https://shop.example/returns' },
    ],
  })

  it('shows a configured button', async () => {
    const c = ctx()
    await action.execute?.({ label: 'Start a return' }, c)
    expect(c.frames[0]).toMatchObject({
      type: 'ui',
      kind: 'button',
      data: { label: 'Start a return', url: 'https://shop.example/returns' },
    })
  })

  it('refuses a label it was not configured with, so the model cannot invent a link', async () => {
    await expect(action.execute?.({ label: 'Download our malware' }, ctx())).rejects.toThrow(/no button called/)
  })

  it('offers the labels as an enum, so the model picks rather than types', () => {
    expect(action.collect?.[0]?.options).toEqual(['Track my order', 'Start a return'])
  })

  it('marks a button that should take the tab it is in, and only that one', async () => {
    const checkout = customButton({
      whenToUse: 'x',
      buttons: [
        { label: 'Pay now', url: 'https://shop.example/pay', sameTab: true },
        { label: 'Read the policy', url: 'https://shop.example/policy' },
      ],
    })

    const c = ctx()
    await checkout.execute?.({ label: 'Pay now' }, c)
    await checkout.execute?.({ label: 'Read the policy' }, c)

    expect(c.frames[0]).toMatchObject({ data: { sameTab: true } })
    expect((c.frames[1] as { data: Record<string, unknown> }).data).not.toHaveProperty('sameTab')
  })
})

describe('custom forms', () => {
  const options = {
    name: 'warranty_claim',
    whenToUse: 'x',
    title: 'Warranty claim',
    fields: [
      { name: 'serial', label: 'Serial number', type: 'string' as const, description: 'On the base' },
      { name: 'bought', label: 'Where bought', type: 'string' as const, description: 'Retailer', required: false },
    ],
  }

  it('runs in the browser, because that is where a form is drawn', () => {
    expect(customForm(options).runs).toBe('client')
  })

  it('sends its field definitions with the request', () => {
    const payload = customForm(options).clientPayload as { form: ReturnType<typeof formSchema> }
    expect(payload.form.title).toBe('Warranty claim')
    expect(payload.form.fields).toHaveLength(2)
  })

  it('marks fields required unless they say otherwise', () => {
    const schema = formSchema(options)
    expect(schema.fields[0]?.required).toBe(true)
    expect(schema.fields[1]?.required).toBe(false)
  })
})

describe('notifying the team', () => {
  it('posts to the Slack webhook with the conversation attached', async () => {
    let sent: any = null
    const action = slackNotify({ webhookUrl: 'https://hooks.slack.test/abc', prefix: '[lumen]' })

    await withFetch(
      mockFetch((_url, init) => {
        sent = JSON.parse(init?.body as string)
        return new Response('ok', { status: 200 })
      }),
      () => action.execute!({ message: 'Customer is upset about a late order.' }, ctx()),
    )

    expect(sent.text).toContain('[lumen]')
    expect(sent.text).toContain('upset about a late order')
    expect(sent.text).toContain('c1')
  })

  it('reports a failed webhook rather than pretending it worked', async () => {
    const action = slackNotify({ webhookUrl: 'https://hooks.slack.test/abc' })
    await withFetch(
      mockFetch(() => new Response('no_service', { status: 404 })),
      async () => {
        await expect(action.execute!({ message: 'x' }, ctx())).rejects.toThrow(/Slack notification failed/)
      },
    )
  })
})

describe('booking a meeting', () => {
  it('shows a link rather than writing to a calendar', async () => {
    const action = scheduleMeeting({ url: 'https://cal.com/lumen/demo' })
    const c = ctx()
    await action.execute?.({ reason: 'wholesale pricing' }, c)
    expect(c.frames[0]).toMatchObject({ type: 'ui', data: { url: 'https://cal.com/lumen/demo' } })
  })
})

describe('Stripe billing lookup', () => {
  const action = stripeBilling({ secretKey: 'sk_test_123' })

  it('reads the plan and the last invoices, trimmed to what a customer asked', async () => {
    const result = await withFetch(
      mockFetch((url) => {
        if (url.includes('/customers')) return Response.json({ data: [{ id: 'cus_1' }] })
        if (url.includes('/subscriptions')) {
          return Response.json({
            data: [
              {
                status: 'active',
                current_period_end: 1767225600,
                cancel_at_period_end: false,
                items: { data: [{ price: { unit_amount: 1800 } }] },
              },
            ],
          })
        }
        return Response.json({
          data: [
            {
              status: 'paid',
              total: 1800,
              currency: 'gbp',
              created: 1764547200,
              hosted_invoice_url: 'https://invoice.example/1',
              // Present in the real payload and deliberately not returned.
              customer_tax_ids: ['secret'],
            },
          ],
        })
      }),
      () => action.execute!({ email: 'sam@example.com' }, ctx()),
    )

    const billing = result as any
    expect(billing.found).toBe(true)
    expect(billing.subscriptions[0]).toMatchObject({ status: 'active', amount: 18 })
    expect(billing.invoices[0]).toMatchObject({ total: 18, currency: 'gbp' })
    expect(JSON.stringify(billing)).not.toContain('customer_tax_ids')
  })

  it('says plainly when no account matches, instead of guessing', async () => {
    const result = await withFetch(
      mockFetch(() => Response.json({ data: [] })),
      () => action.execute!({ email: 'nobody@example.com' }, ctx()),
    )
    expect((result as any).found).toBe(false)
  })

  it('needs an email', async () => {
    await expect(action.execute?.({ email: '  ' }, ctx())).rejects.toThrow(/email address is needed/)
  })

  it('reports a Stripe outage as a failure, not as "no account"', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await withFetch(
      mockFetch(() => new Response('down', { status: 503 })),
      async () => {
        await expect(action.execute!({ email: 'a@b.co' }, ctx())).rejects.toThrow(/Stripe lookup failed/)
      },
    )
    spy.mockRestore()
  })
})

describe('Shopify order lookup', () => {
  const action = shopifyOrders({ shop: 'lumen.myshopify.com', accessToken: 'shpat_1' })

  const order = {
    name: '#1001',
    created_at: '2026-08-20T10:00:00Z',
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    total_price: '21.50',
    currency: 'GBP',
    line_items: [{ title: 'Ethiopia Guji 250g', quantity: 1 }],
    fulfillments: [{ tracking_number: 'AB123', tracking_url: 'https://track.example/AB123' }],
  }

  it('finds an order by number and returns its tracking', async () => {
    let called = ''
    const result = await withFetch(
      mockFetch((url) => {
        called = url
        return Response.json({ orders: [order] })
      }),
      () => action.execute!({ orderNumber: '1001' }, ctx()),
    )

    // Shopify matches on the order name, which includes the hash.
    expect(decodeURIComponent(called)).toContain('name=#1001')
    const orders = (result as any).orders
    expect(orders[0].fulfillmentStatus).toBe('fulfilled')
    expect(orders[0].tracking[0].number).toBe('AB123')
  })

  it('accepts a number the customer already typed with a hash', async () => {
    let called = ''
    await withFetch(
      mockFetch((url) => {
        called = url
        return Response.json({ orders: [] })
      }),
      () => action.execute!({ orderNumber: '#1001' }, ctx()),
    )
    expect(decodeURIComponent(called)).not.toContain('##')
  })

  it('reports unfulfilled rather than null, which a model reads as unknown', async () => {
    const result = await withFetch(
      mockFetch(() => Response.json({ orders: [{ ...order, fulfillment_status: null }] })),
      () => action.execute!({ orderNumber: '1001' }, ctx()),
    )
    expect((result as any).orders[0].fulfillmentStatus).toBe('unfulfilled')
  })

  it('needs something to search on', async () => {
    await expect(action.execute?.({}, ctx())).rejects.toThrow(/order number or an email/)
  })

  it('says nothing matched rather than inventing an order', async () => {
    const result = await withFetch(
      mockFetch(() => Response.json({ orders: [] })),
      () => action.execute!({ email: 'nobody@example.com' }, ctx()),
    )
    expect((result as any).found).toBe(false)
  })
})

describe('errors from a commerce lookup', () => {
  it('never puts the customer’s email into the message the model sees', async () => {
    const action = stripeBilling({ secretKey: 'sk_test_123' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await withFetch(
      mockFetch(() => new Response('down', { status: 503 })),
      async () => {
        // The underlying failure names the URL, and that URL contains the
        // address. What reaches the agent must not.
        await expect(action.execute!({ email: 'sam@example.com' }, ctx())).rejects.toThrow(
          /^Stripe lookup failed$/,
        )
      },
    )

    spy.mockRestore()
  })

  it('keeps a Shopify email out of the message too', async () => {
    const action = shopifyOrders({ shop: 's.myshopify.com', accessToken: 't' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await withFetch(
      mockFetch(() => new Response('down', { status: 502 })),
      async () => {
        await expect(action.execute!({ email: 'sam@example.com' }, ctx())).rejects.toThrow(
          /^Shopify lookup failed$/,
        )
      },
    )

    spy.mockRestore()
  })
})
