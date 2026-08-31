import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createWebhooks, signWebhook, verifyWebhook } from '../src/webhooks/index.js'

describe('signing a delivery', () => {
  const secret = 'whsec_test'
  const body = JSON.stringify({ event: 'lead.captured' })

  it('signs the timestamp together with the body', async () => {
    const expected = createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex')
    expect(await signWebhook(body, secret, 1700000000)).toBe(`t=1700000000,v1=${expected}`)
  })

  it('accepts its own signature', async () => {
    const header = await signWebhook(body, secret, 1700000000)
    expect(await verifyWebhook(body, header, secret, 300, 1700000000)).toBe(true)
  })

  it('rejects a body that changed after signing', async () => {
    const header = await signWebhook(body, secret, 1700000000)
    expect(await verifyWebhook(`${body} `, header, secret, 300, 1700000000)).toBe(false)
  })

  it('rejects the wrong secret', async () => {
    const header = await signWebhook(body, 'other', 1700000000)
    expect(await verifyWebhook(body, header, secret, 300, 1700000000)).toBe(false)
  })

  it('rejects a replay from outside the window', async () => {
    const header = await signWebhook(body, secret, 1700000000)
    expect(await verifyWebhook(body, header, secret, 300, 1700000000 + 400)).toBe(false)
  })

  it('rejects a timestamp swapped for a fresh one, because it is signed too', async () => {
    const header = await signWebhook(body, secret, 1700000000)
    const forged = header.replace('t=1700000000', 't=1700000900')
    expect(await verifyWebhook(body, forged, secret, 300, 1700000900)).toBe(false)
  })

  it('rejects a missing or malformed header', async () => {
    expect(await verifyWebhook(body, null, secret)).toBe(false)
    expect(await verifyWebhook(body, 'nonsense', secret)).toBe(false)
    expect(await verifyWebhook(body, 't=abc,v1=x', secret)).toBe(false)
  })
})

describe('delivering events', () => {
  function collector() {
    const pending: Promise<unknown>[] = []
    return { waitUntil: (p: Promise<unknown>) => void pending.push(p), settled: () => Promise.all(pending) }
  }

  it('sends only to endpoints subscribed to that event', async () => {
    const hits: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async (url) => {
      hits.push(String(url))
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const pending = collector()
    try {
      const webhooks = createWebhooks({
        waitUntil: pending.waitUntil,
        endpoints: [
          { url: 'https://crm.example/hook', events: ['lead.captured'] },
          { url: 'https://oncall.example/hook', events: ['ticket.opened'] },
          { url: 'https://everything.example/hook' },
        ],
      })

      webhooks.emit('lead.captured', { email: 'a@b.co' })
      await pending.settled()
    } finally {
      globalThis.fetch = original
    }

    expect(hits).toEqual(['https://crm.example/hook', 'https://everything.example/hook'])
  })

  it('signs each delivery and gives it an id to deduplicate on', async () => {
    let headers: Headers | undefined
    let body = ''
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async (_url, init) => {
      headers = new Headers((init as RequestInit).headers)
      body = (init as RequestInit).body as string
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const pending = collector()
    try {
      const webhooks = createWebhooks({
        secret: 'whsec_test',
        waitUntil: pending.waitUntil,
        endpoints: [{ url: 'https://crm.example/hook' }],
      })
      webhooks.emit('ticket.opened', { ticketNumber: 1 })
      await pending.settled()
    } finally {
      globalThis.fetch = original
    }

    expect(headers?.get('x-recourse-event')).toBe('ticket.opened')
    expect(headers?.get('x-recourse-delivery')).toMatch(/^whd_/)
    expect(await verifyWebhook(body, headers?.get('x-recourse-signature') ?? null, 'whsec_test')).toBe(true)
  })

  it('uses a per-endpoint secret over the shared one', async () => {
    let headers: Headers | undefined
    let body = ''
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async (_url, init) => {
      headers = new Headers((init as RequestInit).headers)
      body = (init as RequestInit).body as string
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const pending = collector()
    try {
      createWebhooks({
        secret: 'shared',
        waitUntil: pending.waitUntil,
        endpoints: [{ url: 'https://crm.example/hook', secret: 'per-endpoint' }],
      }).emit('lead.captured', {})
      await pending.settled()
    } finally {
      globalThis.fetch = original
    }

    expect(await verifyWebhook(body, headers?.get('x-recourse-signature') ?? null, 'per-endpoint')).toBe(true)
    expect(await verifyWebhook(body, headers?.get('x-recourse-signature') ?? null, 'shared')).toBe(false)
  })

  it('reports a failing endpoint without taking anything else down', async () => {
    const errors: Array<{ url: string }> = []
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response('gone', { status: 410 })) as unknown as typeof fetch
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const pending = collector()
    try {
      createWebhooks({
        attempts: 1,
        waitUntil: pending.waitUntil,
        onError: (_error, context) => void errors.push({ url: context.url }),
        endpoints: [{ url: 'https://dead.example/hook' }],
      }).emit('lead.captured', {})
      await pending.settled()
    } finally {
      globalThis.fetch = original
      spy.mockRestore()
    }

    expect(errors[0]?.url).toBe('https://dead.example/hook')
  })

  it('does nothing at all when no endpoint wants the event', () => {
    const original = globalThis.fetch
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    try {
      createWebhooks({ endpoints: [{ url: 'https://x.example', events: ['ticket.opened'] }] }).emit(
        'lead.captured',
        {},
      )
    } finally {
      globalThis.fetch = original
    }
    expect(spy).not.toHaveBeenCalled()
  })
})

/**
 * An automation platform hands you a URL to paste somewhere. If that somewhere
 * is the deployment's source, adding a second one is a redeploy, which is the
 * difference between a library that supports Zapier and one that technically
 * could.
 */
describe('endpoints that are not known at boot', () => {
  it('asks for them on each event', async () => {
    const asked: string[] = []
    const sent: string[] = []

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      sent.push(String(url))
      return new Response('ok', { status: 200 })
    })

    const waiting: Array<Promise<unknown>> = []
    let live = ['https://hooks.zapier.example/one']

    const webhooks = createWebhooks({
      endpoints: () => {
        asked.push('read')
        return live.map((url) => ({ url }))
      },
      waitUntil: (work) => void waiting.push(work),
    })

    webhooks.emit('lead.captured', { email: 'sam@example.com' })
    await Promise.allSettled(waiting)

    // Added without a restart, which is the whole point.
    live = [...live, 'https://flow.viasocket.example/two']
    webhooks.emit('lead.captured', { email: 'ada@example.com' })
    await Promise.allSettled(waiting)

    expect(asked).toHaveLength(2)
    expect(sent).toEqual([
      'https://hooks.zapier.example/one',
      'https://hooks.zapier.example/one',
      'https://flow.viasocket.example/two',
    ])

    spy.mockRestore()
  })

  it('does not take the answer down when they cannot be read', async () => {
    const waiting: Array<Promise<unknown>> = []
    const failures: unknown[] = []

    const webhooks = createWebhooks({
      endpoints: () => Promise.reject(new Error('the database is asleep')),
      waitUntil: (work) => void waiting.push(work),
      onError: (error) => void failures.push(error),
    })

    // Emitting is not awaited by the answer path, so a lookup that throws has
    // to end up in onError rather than as an unhandled rejection.
    expect(() => webhooks.emit('lead.captured', {})).not.toThrow()
    await Promise.allSettled(waiting)

    expect(failures).toHaveLength(1)
  })
})
