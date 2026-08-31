/**
 * Taking the call in the browser, without handing the browser a key.
 *
 * The other four voice paths answer a telephone. This one is the widget: a
 * visitor clicks Call on the page they are already reading and speaks to the
 * agent, which is the shape people actually reach for when the thing they want
 * to ask is on the screen in front of them.
 *
 * The voice runtime is ElevenLabs, reached over a WebSocket the browser opens
 * itself. That connection has to be authorised, and the only credential that
 * authorises it is an account key which must never be sent to a page. So this
 * endpoint is the swap: the browser asks it for permission, it spends the key
 * server-side and hands back a short-lived signed URL good for one connection.
 *
 * Read the rate limiting below as part of the feature rather than decoration.
 * Every success here is a billable minute on somebody's account, and an open
 * endpoint that mints them is a way to spend their money.
 */

import { corsHeaders, type CorsOptions } from '../server/cors.js'
import { callerKey, createRateLimiter, type RateLimitOptions, type RateLimiter } from '../server/ratelimit.js'

/** Where the signed URL comes from. Overridable so tests need no network. */
const SIGNED_URL_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url'

/**
 * How long the URL stays usable, as documented by the service.
 *
 * Reported to the caller rather than kept private: the widget needs to know
 * whether the URL it is holding is still worth trying, and the alternative is
 * every client hardcoding the same number and drifting from it.
 */
export const SIGNED_URL_TTL_SECONDS = 900

export interface BrowserVoiceOptions {
  /** The agent that answers. Created in the voice provider's own dashboard. */
  agentId: string
  /**
   * Account key. Server-side only, and the reason this endpoint exists: it is
   * spent here so that it is never in a page anyone can read.
   */
  apiKey: string
  cors?: CorsOptions
  /**
   * Deliberately tight by default, because the thing being handed out costs
   * money. The in-memory limiter is per-instance and approximate, so treat it
   * as a guard against a script rather than as a spending control; pass
   * `rateLimiter` for one that actually holds across instances.
   */
  rateLimit?: RateLimitOptions
  rateLimiter?: RateLimiter
  /** Injected so the suite never reaches the network. */
  fetch?: typeof globalThis.fetch
}

export interface SignedUrlResponse {
  signedUrl: string
  expiresInSeconds: number
}

export function browserVoiceRoute(options: BrowserVoiceOptions) {
  const inMemory = createRateLimiter(options.rateLimit ?? { limit: 5, windowMs: 10 * 60_000 })
  const limiter: RateLimiter = options.rateLimiter ?? { check: inMemory }
  const call = options.fetch ?? globalThis.fetch

  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request, options.cors)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    // POST rather than GET, because the reply is a credential. A GET is the
    // kind of thing a proxy or a browser will happily keep a copy of, and one
    // cached signed URL is somebody else's call.
    if (request.method !== 'POST') {
      return json({ error: 'use POST: the response is a credential and must not be cached' }, 405, cors)
    }

    const gate = await limiter.check(callerKey(request))
    if (!gate.ok) {
      return json({ error: 'too many calls started, try again shortly' }, 429, {
        ...cors,
        'retry-after': String(gate.retryAfter),
      })
    }

    let response: Response
    try {
      response = await call(`${SIGNED_URL_ENDPOINT}?agent_id=${encodeURIComponent(options.agentId)}`, {
        headers: { 'xi-api-key': options.apiKey },
      })
    } catch (error) {
      // The message can carry the request, and the request carries the key.
      console.error('[recourse] could not reach the voice provider:', error)
      return json({ error: 'the voice service could not be reached' }, 502, cors)
    }

    if (!response.ok) {
      // Logged with the status only. Their body has been known to echo request
      // details back, and this one had a key in it.
      console.error(`[recourse] voice provider refused to sign a URL: ${response.status}`)
      return json({ error: 'the voice service refused the call' }, 502, cors)
    }

    const body = (await response.json().catch(() => ({}))) as { signed_url?: unknown }
    if (typeof body.signed_url !== 'string' || !body.signed_url) {
      console.error('[recourse] voice provider returned no signed URL')
      return json({ error: 'the voice service returned nothing usable' }, 502, cors)
    }

    return json({ signedUrl: body.signed_url, expiresInSeconds: SIGNED_URL_TTL_SECONDS }, 200, {
      ...cors,
      // Belt and braces alongside the POST: this must not be stored anywhere.
      'cache-control': 'no-store',
    })
  }
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}
