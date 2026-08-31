import { fetchWithRetry } from '../util/http.js'

/**
 * Outbound webhooks.
 *
 * The store tells you what happened inside your own deployment; a webhook tells
 * everything else. A captured lead belongs in the CRM, an opened ticket belongs
 * on the on-call rota, and neither should require polling an API to discover.
 */

export type WebhookEvent =
  | 'conversation.answered'
  | 'conversation.unanswered'
  | 'lead.captured'
  | 'ticket.opened'
  | 'ticket.updated'
  | 'message.feedback'

export interface WebhookEndpoint {
  url: string
  /** Omit to receive everything. */
  events?: WebhookEvent[]
  /** Per-endpoint secret, overriding the shared one. */
  secret?: string
  headers?: Record<string, string>
}

export interface WebhookOptions {
  /**
   * Where deliveries go, as a list or as a function called per event.
   *
   * A list is right when the receivers are part of the deployment. A function
   * is right when they are not: an automation platform hands you a URL to
   * paste in, and somebody adding a second one should not need a redeploy to
   * do it. Read them from wherever you keep them and return them here.
   *
   *     endpoints: () => db.webhookEndpoints.findMany()
   */
  endpoints: WebhookEndpoint[] | (() => WebhookEndpoint[] | Promise<WebhookEndpoint[]>)
  /** Signs every delivery that has no endpoint secret of its own. */
  secret?: string
  /** Attempts per endpoint before giving up. */
  attempts?: number
  waitUntil?: (promise: Promise<unknown>) => void
  onError?: (error: unknown, context: { url: string; event: WebhookEvent }) => void
}

export interface WebhookDelivery {
  id: string
  event: WebhookEvent
  createdAt: string
  data: Record<string, unknown>
}

const encoder = new TextEncoder()

/**
 * Signs a delivery as `t=<unix>,v1=<hex>` over `timestamp.body`.
 *
 * The timestamp is inside the signed material rather than beside it, which is
 * what stops a captured delivery being replayed later with its own timestamp
 * swapped in. This is the scheme Stripe popularised, so most receivers already
 * have code that verifies it.
 */
export async function signWebhook(body: string, secret: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`))
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `t=${timestamp},v1=${hex}`
}

/**
 * Verifies a delivery. Exported so a receiver written with this library can
 * check its own webhooks without reimplementing the scheme.
 */
export async function verifyWebhook(
  body: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header) return false

  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, ...rest] = part.split('=')
      return [key?.trim(), rest.join('=').trim()]
    }),
  )

  const timestamp = Number.parseInt(parts.t ?? '', 10)
  if (!Number.isFinite(timestamp) || !parts.v1) return false
  if (Math.abs(now - timestamp) > toleranceSeconds) return false

  const expected = await signWebhook(body, secret, timestamp)
  const presented = `t=${timestamp},v1=${parts.v1}`

  if (expected.length !== presented.length) return false
  let difference = 0
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ presented.charCodeAt(i)
  return difference === 0
}

export function createWebhooks(options: WebhookOptions) {
  const attempts = options.attempts ?? 3

  async function deliver(endpoint: WebhookEndpoint, delivery: WebhookDelivery): Promise<void> {
    const body = JSON.stringify(delivery)
    const secret = endpoint.secret ?? options.secret

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Helpdeck-Event': delivery.event,
      // Receivers deduplicate on this, because a retried delivery is a
      // successful delivery whose acknowledgement got lost.
      'X-Helpdeck-Delivery': delivery.id,
      ...endpoint.headers,
    }

    if (secret) {
      headers['X-Helpdeck-Signature'] = await signWebhook(body, secret, Math.floor(Date.now() / 1000))
    }

    const response = await fetchWithRetry(endpoint.url, { method: 'POST', headers, body }, { attempts })
    if (!response.ok) throw new Error(`webhook rejected with ${response.status}`)
  }

  return {
    /**
     * Sends an event to every endpoint subscribed to it.
     *
     * Never awaited by the caller: a support answer must not be held up, or
     * fail, because somebody's CRM is down.
     */
    emit(event: WebhookEvent, data: Record<string, unknown>): void {
      const delivery: WebhookDelivery = {
        id: `whd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        event,
        createdAt: new Date().toISOString(),
        data,
      }

      // Resolved inside the promise, because looking the endpoints up may
      // touch a database and this is called from the answer path, which is
      // never allowed to wait for one.
      const work = (async () => {
        const all = typeof options.endpoints === 'function' ? await options.endpoints() : options.endpoints
        const subscribed = all.filter(
          (endpoint) => !endpoint.events?.length || endpoint.events.includes(event),
        )

        await Promise.all(
          subscribed.map((endpoint) =>
            deliver(endpoint, delivery).catch((error: unknown) => {
              options.onError?.(error, { url: endpoint.url, event })
              console.error(`[helpdeck] webhook to ${endpoint.url} failed`, error)
            }),
          ),
        )
      })().catch((error: unknown) => {
        options.onError?.(error, { url: 'endpoints', event })
        console.error('[helpdeck] could not read the webhook endpoints', error)
      })

      if (options.waitUntil) options.waitUntil(work)
    },
  }
}

export type Webhooks = ReturnType<typeof createWebhooks>
