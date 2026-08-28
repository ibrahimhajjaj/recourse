import { describe, expect, it, vi } from 'vitest'
import { liveChat, salesforceCases, transferToPhone } from '../src/actions/index.js'
import type { StreamFrame } from '../src/types.js'

function ctx() {
  const frames: StreamFrame[] = []
  return { frames, emit: (frame: StreamFrame) => frames.push(frame), conversationId: 'c1' }
}

describe('live chat handoff', () => {
  it('connects and tells the customer their place in the queue', async () => {
    const connected: unknown[] = []
    const action = liveChat({
      connect: (request) => {
        connected.push(request)
        return { queuePosition: 2 }
      },
    })

    const c = ctx()
    const result = (await action.execute?.({ summary: 'Charged twice', email: 'sam@example.com' }, c)) as {
      connected: boolean
    }

    expect(result.connected).toBe(true)
    expect(connected[0]).toMatchObject({ summary: 'Charged twice', conversationId: 'c1' })
    expect(c.frames[0]).toMatchObject({ type: 'handoff' })
    expect((c.frames[0] as { message: string }).message).toContain('number 2')
  })

  it('does not promise a person who is asleep', async () => {
    const action = liveChat({
      isAvailable: () => false,
      connect: () => {
        throw new Error('should never connect')
      },
    })

    const result = (await action.execute?.({ summary: 'x' }, ctx())) as { connected: boolean; message: string }
    expect(result.connected).toBe(false)
    expect(result.message).toContain('Nobody is available')
  })

  it('falls back to the known contact when the model did not collect one', async () => {
    const seen: Array<{ email?: string }> = []
    const action = liveChat({ connect: (request) => void seen.push(request) })

    await action.execute?.({ summary: 'x' }, { ...ctx(), contact: { email: 'known@example.com' } })
    expect(seen[0]?.email).toBe('known@example.com')
  })
})

describe('transfer to phone', () => {
  it('offers a call button when there is no call to transfer', async () => {
    const action = transferToPhone({ phoneNumber: '+442071234567' })
    const c = ctx()

    const result = (await action.execute?.({}, c)) as { transferred: boolean }
    expect(result.transferred).toBe(false)
    expect(c.frames[0]).toMatchObject({ type: 'ui', data: { url: 'tel:+442071234567' } })
  })

  it('transfers for real when the channel can', async () => {
    const transferred: string[] = []
    const action = transferToPhone({
      phoneNumber: '+442071234567',
      transfer: (to) => void transferred.push(to),
    })

    const result = (await action.execute?.({}, ctx())) as { transferred: boolean }
    expect(result.transferred).toBe(true)
    expect(transferred).toEqual(['+442071234567'])
  })

  it('will not offer a closed phone line', async () => {
    vi.useFakeTimers()
    // A Sunday, outside any weekday window.
    vi.setSystemTime(new Date('2026-08-30T12:00:00'))
    try {
      const action = transferToPhone({ phoneNumber: '+44', hours: { open: 9, close: 17 } })
      const result = (await action.execute?.({}, ctx())) as { transferred: boolean; message: string }
      expect(result.transferred).toBe(false)
      expect(result.message).toContain('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers it during opening hours on a weekday', async () => {
    vi.useFakeTimers()
    // A Wednesday at 11am.
    vi.setSystemTime(new Date('2026-08-26T11:00:00'))
    try {
      const action = transferToPhone({ phoneNumber: '+44', hours: { open: 9, close: 17 } })
      const c = ctx()
      await action.execute?.({}, c)
      expect(c.frames[0]).toMatchObject({ type: 'ui' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('salesforce cases', () => {
  it('creates a case and returns its id', async () => {
    const original = globalThis.fetch
    let sent: Record<string, unknown> = {}

    globalThis.fetch = vi.fn(async (_url, init) => {
      sent = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
      return Response.json({ id: '500XX' }, { status: 201 })
    }) as unknown as typeof fetch

    try {
      const create = salesforceCases({ instanceUrl: 'https://acme.my.salesforce.com', accessToken: 'tok' })
      const result = await create({ subject: 'Charged twice', body: 'Two payments', email: 'a@b.co', priority: 'urgent' })

      expect(result.id).toBe('500XX')
      expect(sent).toMatchObject({ Subject: 'Charged twice', SuppliedEmail: 'a@b.co', Priority: 'High' })
    } finally {
      globalThis.fetch = original
    }
  })

  it('reports a failure rather than pretending a case exists', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch

    try {
      const create = salesforceCases({ instanceUrl: 'https://acme.my.salesforce.com', accessToken: 'bad' })
      await expect(create({ subject: 'a', body: 'b' })).rejects.toThrow(/Salesforce case creation failed/)
    } finally {
      globalThis.fetch = original
    }
  })
})
