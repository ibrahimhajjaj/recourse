import { defineAction } from '../define.js'
import type { Action } from '../types.js'
import { fetchWithRetry } from '../../util/http.js'

/**
 * Commerce lookups.
 *
 * Every one of these is read-only. An agent that can read a subscription
 * answers most billing questions on its own; an agent that can cancel one will
 * eventually cancel the wrong one, and the customer will not find out until the
 * coffee stops arriving. Cancellations belong behind a procedure and a person.
 */

export interface StripeOptions {
  /** A restricted key with read access is enough, and is what you should use. */
  secretKey: string
  whenToUse?: string
  procedureOnly?: boolean
  apiBase?: string
}

/**
 * Looks up a customer's subscription and recent invoices by email.
 *
 * Matching on email is the trade this makes: it is the only identifier a
 * customer reliably knows. Pair it with verified identity when the answers
 * matter, or an unverified visitor can read anyone's billing history.
 */
export function stripeBilling(options: StripeOptions): Action {
  const base = options.apiBase ?? 'https://api.stripe.com/v1'

  /**
   * Whatever goes wrong, the agent is told the same short sentence.
   *
   * The underlying failure carries the request URL, and for a customer lookup
   * that URL contains their email address. That message would travel into the
   * model's context and from there into a reply, so it stays in the log.
   */
  async function stripe(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetchWithRetry(
        `${base}${path}`,
        { headers: { Authorization: `Bearer ${options.secretKey}` } },
        { signal, attempts: 2 },
      )
    } catch (error) {
      console.error('[recourse] stripe request failed', error)
      throw new Error('Stripe lookup failed')
    }

    if (!response.ok) throw new Error(`Stripe lookup failed (${response.status})`)
    return (await response.json()) as Record<string, unknown>
  }

  return defineAction({
    name: 'look_up_billing',
    whenToUse:
      options.whenToUse ??
      "Use for questions about the customer's plan, what they were charged, when they are next billed, " +
        'or a receipt. Ask for the email on the account if you do not already have it.',
    procedureOnly: options.procedureOnly,
    collect: [{ name: 'email', type: 'string', description: 'The email address on the billing account.' }],

    async execute(input, ctx) {
      const email = String(input.email ?? '').trim()
      if (!email) throw new Error('an email address is needed to look up billing')


      const customers = (await stripe(`/customers?email=${encodeURIComponent(email)}&limit=1`, ctx.signal)) as {
        data?: Array<{ id?: string }>
      }
      const customerId = customers.data?.[0]?.id
      if (!customerId) {
        return { found: false, message: 'No billing account with that email. Ask them to check the address.' }
      }

      const [subscriptions, invoices] = await Promise.all([
        stripe(`/subscriptions?customer=${customerId}&limit=3`, ctx.signal) as Promise<{
          data?: Array<Record<string, unknown>>
        }>,
        stripe(`/invoices?customer=${customerId}&limit=3`, ctx.signal) as Promise<{
          data?: Array<Record<string, unknown>>
        }>,
      ])


      // Trimmed hard: a raw Stripe object is thousands of tokens of internal
      // ids and flags, none of which a customer asked about.
      return {
        found: true,
        subscriptions: (subscriptions.data ?? []).map((subscription) => ({
          status: subscription.status,
          currentPeriodEnd: toDate(subscription.current_period_end),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          amount: readAmount(subscription),
        })),
        invoices: (invoices.data ?? []).map((invoice) => ({
          status: invoice.status,
          total: typeof invoice.total === 'number' ? invoice.total / 100 : null,
          currency: invoice.currency,
          created: toDate(invoice.created),
          receiptUrl: invoice.hosted_invoice_url,
        })),
      }
    },
  })
}

function toDate(seconds: unknown): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString().slice(0, 10) : null
}

function readAmount(subscription: Record<string, unknown>): number | null {
  const items = (subscription.items as { data?: Array<{ price?: { unit_amount?: number } }> })?.data
  const amount = items?.[0]?.price?.unit_amount
  return typeof amount === 'number' ? amount / 100 : null
}

export interface ShopifyOptions {
  /** The myshopify domain, such as `lumen-coffee.myshopify.com`. */
  shop: string
  /** An Admin API access token with read_orders. */
  accessToken: string
  apiVersion?: string
  whenToUse?: string
  procedureOnly?: boolean
  apiBase?: string
}

/**
 * Looks up an order and its delivery state.
 *
 * "Where is my order" is the single most common support question in commerce,
 * and it is entirely answerable from data the shop already has.
 */
export function shopifyOrders(options: ShopifyOptions): Action {
  const version = options.apiVersion ?? '2025-01'
  const base = options.apiBase ?? `https://${options.shop}/admin/api/${version}`

  return defineAction({
    name: 'look_up_order',
    whenToUse:
      options.whenToUse ??
      'Use for questions about a specific order: where it is, whether it shipped, what was in it, ' +
        'or when it will arrive. Ask for the order number or the email it was placed with.',
    procedureOnly: options.procedureOnly,
    collect: [
      { name: 'orderNumber', type: 'string', description: 'The order number, with or without the #.', required: false },
      { name: 'email', type: 'string', description: 'The email the order was placed with.', required: false },
    ],

    async execute(input, ctx) {
      const orderNumber = String(input.orderNumber ?? '').trim()
      const email = String(input.email ?? '').trim()
      if (!orderNumber && !email) throw new Error('an order number or an email is needed')

      const query = new URLSearchParams({ status: 'any', limit: '3' })
      // Shopify matches the order name including its # prefix.
      if (orderNumber) query.set('name', orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`)
      if (email) query.set('email', email)


      let response: Response
      try {
        response = await fetchWithRetry(
          `${base}/orders.json?${query.toString()}`,
          { headers: { 'X-Shopify-Access-Token': options.accessToken } },
          { signal: ctx.signal, attempts: 2 },
        )
      } catch (error) {
        // The query string carries the customer's email; keep it out of the
        // message the model sees.
        console.error('[recourse] shopify request failed', error)
        throw new Error('Shopify lookup failed')
      }

      if (!response.ok) throw new Error(`Shopify lookup failed (${response.status})`)

      const body = (await response.json()) as { orders?: Array<Record<string, unknown>> }

      const orders = (body.orders ?? []).map((order) => ({
        name: order.name,
        placedAt: typeof order.created_at === 'string' ? order.created_at.slice(0, 10) : null,
        financialStatus: order.financial_status,
        fulfillmentStatus: order.fulfillment_status ?? 'unfulfilled',
        total: order.total_price,
        currency: order.currency,
        items: ((order.line_items as Array<{ title?: string; quantity?: number }>) ?? []).map((item) => ({
          title: item.title,
          quantity: item.quantity,
        })),
        tracking: ((order.fulfillments as Array<{ tracking_number?: string; tracking_url?: string }>) ?? []).map(
          (fulfillment) => ({ number: fulfillment.tracking_number, url: fulfillment.tracking_url }),
        ),
      }))

      return orders.length > 0
        ? { found: true, orders }
        : { found: false, message: 'No order matched. Ask them to check the number or the email.' }
    },
  })
}
