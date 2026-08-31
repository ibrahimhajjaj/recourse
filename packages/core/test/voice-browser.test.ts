import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIGNED_URL_TTL_SECONDS, browserVoiceRoute } from '../src/channels/voice-browser.js'

const SIGNED = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a1&conversation_signature=sig'

/** A provider that signs, and remembers how it was asked. */
function signer(body: unknown = { signed_url: SIGNED }, status = 200) {
  const calls: Array<{ url: string; key: string | undefined }> = []

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(input), key: headers.get('xi-api-key') ?? undefined })

    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof globalThis.fetch

  return { fetch, calls }
}

const ask = (extra: RequestInit = {}) =>
  new Request('https://shop.example/api/voice/token', { method: 'POST', ...extra })

describe('handing the browser a way in', () => {
  let errors: string[] = []

  beforeEach(() => {
    errors = []
    vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args.join(' ')))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('spends the key server-side and returns only the signed URL', async () => {
    const provider = signer()
    const handle = browserVoiceRoute({ agentId: 'a1', apiKey: 'sk-secret', fetch: provider.fetch })

    const response = await handle(ask())
    const body = (await response.json()) as { signedUrl: string; expiresInSeconds: number }

    expect(response.status).toBe(200)
    expect(body.signedUrl).toBe(SIGNED)
    expect(body.expiresInSeconds).toBe(SIGNED_URL_TTL_SECONDS)

    // The whole point of the endpoint: the key was used, and did not come back.
    expect(provider.calls[0]?.key).toBe('sk-secret')
    expect(JSON.stringify(body)).not.toContain('sk-secret')
  })

  it('asks for the agent it was configured with, escaped', async () => {
    const provider = signer()
    const handle = browserVoiceRoute({ agentId: 'a/1 b', apiKey: 'k', fetch: provider.fetch })
    await handle(ask())

    expect(provider.calls[0]?.url).toContain('agent_id=a%2F1%20b')
  })

  it('refuses a GET, because the answer is a credential', async () => {
    const provider = signer()
    const handle = browserVoiceRoute({ agentId: 'a1', apiKey: 'k', fetch: provider.fetch })

    const response = await handle(new Request('https://shop.example/api/voice/token'))

    expect(response.status).toBe(405)
    // And it did not quietly spend a call finding that out.
    expect(provider.calls).toHaveLength(0)
  })

  it('tells the browser not to store it', async () => {
    const handle = browserVoiceRoute({ agentId: 'a1', apiKey: 'k', fetch: signer().fetch })
    const response = await handle(ask())

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('answers a preflight without minting anything', async () => {
    const provider = signer()
    const handle = browserVoiceRoute({ agentId: 'a1', apiKey: 'k', fetch: provider.fetch })

    const response = await handle(new Request('https://shop.example/api/voice/token', { method: 'OPTIONS' }))

    expect(response.status).toBe(204)
    expect(provider.calls).toHaveLength(0)
  })
})

describe('not letting somebody spend the account', () => {
  it('stops after the configured number of calls, with a retry hint', async () => {
    const provider = signer()
    const handle = browserVoiceRoute({
      agentId: 'a1',
      apiKey: 'k',
      rateLimit: { limit: 2, windowMs: 60_000 },
      fetch: provider.fetch,
    })

    const from = { headers: { 'x-forwarded-for': '203.0.113.9' } }

    expect((await handle(ask(from))).status).toBe(200)
    expect((await handle(ask(from))).status).toBe(200)

    const third = await handle(ask(from))
    expect(third.status).toBe(429)
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0)

    // Refusing has to be free, or the limiter is the attack rather than the guard.
    expect(provider.calls).toHaveLength(2)
  })

  it('defaults to a tight limit, since each success is billable', async () => {
    const provider = signer()
    const handle = browserVoiceRoute({ agentId: 'a1', apiKey: 'k', fetch: provider.fetch })
    const from = { headers: { 'x-forwarded-for': '198.51.100.4' } }

    const codes: number[] = []
    for (let attempt = 0; attempt < 8; attempt++) codes.push((await handle(ask(from))).status)

    expect(codes).toContain(429)
    expect(codes.filter((code) => code === 200).length).toBeLessThanOrEqual(5)
  })

  it('lets a shared limiter override the per-instance one', async () => {
    const provider = signer()
    const handle = browserVoiceRoute({
      agentId: 'a1',
      apiKey: 'k',
      rateLimiter: { check: async () => ({ ok: false, retryAfter: 42 }) },
      fetch: provider.fetch,
    })

    const response = await handle(ask())

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(provider.calls).toHaveLength(0)
  })
})

describe('when the voice service is having a day', () => {
  let errors: string[] = []

  beforeEach(() => {
    errors = []
    vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args.join(' ')))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const failing = (thrown: unknown) =>
    browserVoiceRoute({
      agentId: 'a1',
      apiKey: 'sk-secret',
      fetch: (async () => {
        throw thrown
      }) as unknown as typeof globalThis.fetch,
    })

  it('does not put the key in the reply when the request throws', async () => {
    // A fetch failure message can carry the request, and the request carries
    // the key, so the visitor gets a sentence and the operator gets the log.
    const response = await failing(new Error('connect ECONNREFUSED xi-api-key=sk-secret'))(ask())
    const text = await response.text()

    expect(response.status).toBe(502)
    expect(text).not.toContain('sk-secret')
  })

  it('reports a refusal by status alone', async () => {
    const handle = browserVoiceRoute({
      agentId: 'a1',
      apiKey: 'sk-secret',
      fetch: signer({ detail: 'bad key sk-secret' }, 401).fetch,
    })

    const response = await handle(ask())

    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('sk-secret')
    expect(errors.join(' ')).toContain('401')
    expect(errors.join(' ')).not.toContain('sk-secret')
  })

  it('treats a reply with no URL in it as a failure rather than passing it on', async () => {
    const handle = browserVoiceRoute({ agentId: 'a1', apiKey: 'k', fetch: signer({ nope: true }).fetch })

    const response = await handle(ask())
    const body = (await response.json()) as { signedUrl?: string; error?: string }

    expect(response.status).toBe(502)
    expect(body.signedUrl).toBeUndefined()
    expect(body.error).toBeTruthy()
  })
})
