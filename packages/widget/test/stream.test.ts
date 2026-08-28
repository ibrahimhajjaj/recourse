import { describe, expect, it, vi } from 'vitest'
import { streamChat } from '../src/stream.js'

/** Serves the given body in fixed-size pieces, to force split frames. */
function respondWith(body: string, sliceSize: number, status = 200): typeof fetch {
  return vi.fn(async () => {
    const encoder = new TextEncoder()
    let cursor = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (cursor >= body.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(body.slice(cursor, cursor + sliceSize)))
        cursor += sliceSize
      },
    })
    return new Response(status === 200 ? stream : null, { status })
  }) as unknown as typeof fetch
}

const BODY =
  'data: {"type":"sources","sources":[{"title":"Refunds","url":"https://x.example/r"}]}\n\n' +
  'data: {"type":"delta","text":"You have "}\n\n' +
  'data: {"type":"delta","text":"30 days [1]."}\n\n' +
  'data: {"type":"done"}\n\n'

async function collect(fetchImpl: typeof fetch) {
  const original = globalThis.fetch
  globalThis.fetch = fetchImpl
  const deltas: string[] = []
  const sources: unknown[] = []
  const errors: string[] = []
  let done = 0

  try {
    await streamChat(
      'https://api.example/chat',
      { messages: [{ role: 'user', content: 'refund?' }] },
      {
        onDelta: (text) => deltas.push(text),
        onSources: (refs) => sources.push(...refs),
        onError: (message) => errors.push(message),
        onDone: () => {
          done++
        },
      },
    )
  } finally {
    globalThis.fetch = original
  }

  return { text: deltas.join(''), sources, errors, done }
}

describe('the event stream client', () => {
  it('reassembles frames that arrive whole', async () => {
    const result = await collect(respondWith(BODY, BODY.length))
    expect(result.text).toBe('You have 30 days [1].')
    expect(result.sources).toHaveLength(1)
    expect(result.errors).toEqual([])
  })

  it('reassembles frames split across network chunks', async () => {
    // Seven bytes at a time cuts through the middle of both JSON payloads and
    // the blank-line separators, which is exactly what a slow network does.
    const result = await collect(respondWith(BODY, 7))
    expect(result.text).toBe('You have 30 days [1].')
    expect(result.sources).toHaveLength(1)
  })

  it('handles a single byte at a time', async () => {
    const result = await collect(respondWith(BODY, 1))
    expect(result.text).toBe('You have 30 days [1].')
  })

  it('skips a malformed frame rather than aborting the answer', async () => {
    const body = 'data: not json\n\n' + 'data: {"type":"delta","text":"still fine"}\n\n' + 'data: {"type":"done"}\n\n'
    const result = await collect(respondWith(body, 9))
    expect(result.text).toBe('still fine')
    expect(result.errors).toEqual([])
  })

  it('surfaces a server error frame', async () => {
    const body = 'data: {"type":"error","message":"provider down"}\n\n'
    const result = await collect(respondWith(body, 11))
    expect(result.errors).toEqual(['provider down'])
  })

  it('explains a rate limit in words a customer can read', async () => {
    const result = await collect(respondWith('', 1, 429))
    expect(result.errors[0]).toMatch(/too many/i)
    expect(result.errors[0]).not.toMatch(/429/)
  })

  it('reports an unreachable endpoint instead of hanging', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('network error')
    }) as unknown as typeof fetch
    const result = await collect(failing)
    expect(result.errors[0]).toMatch(/could not reach/i)
  })

  it('reports a server failure with its status', async () => {
    const result = await collect(respondWith('', 1, 500))
    expect(result.errors[0]).toContain('500')
  })
})

describe('the request the client sends', () => {
  it('carries identity, conversation and action results alongside the messages', async () => {
    const original = globalThis.fetch
    let sent: Record<string, unknown> = {}

    globalThis.fetch = vi.fn(async (_url, init) => {
      sent = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
      return new Response('data: {"type":"done"}\n\n', { status: 200 })
    }) as unknown as typeof fetch

    try {
      await streamChat(
        'https://api.example/chat',
        {
          messages: [{ role: 'user', content: 'hi' }],
          conversationId: 'c1',
          userId: 'u1',
          userHash: 'h'.repeat(64),
          actionResults: [{ name: 'read_cart', output: { items: 2 } }],
        },
        {},
      )
    } finally {
      globalThis.fetch = original
    }

    expect(sent.conversationId).toBe('c1')
    expect(sent.userId).toBe('u1')
    expect(sent.actionResults).toEqual([{ name: 'read_cart', output: { items: 2 } }])
    // Messages are reduced to role and content; nothing local leaks to the server.
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('surfaces every frame to onFrame, including ones it has no handler for', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          'data: {"type":"client-action","id":"a1","name":"read_cart","input":{}}\n\n' +
            'data: {"type":"suggestions","items":["one"]}\n\n' +
            'data: {"type":"done"}\n\n',
          { status: 200 },
        ),
    ) as unknown as typeof fetch

    const seen: string[] = []
    try {
      await streamChat(
        'https://api.example/chat',
        { messages: [{ role: 'user', content: 'hi' }] },
        { onFrame: (frame) => seen.push(frame.type) },
      )
    } finally {
      globalThis.fetch = original
    }

    expect(seen).toContain('client-action')
    expect(seen).toContain('suggestions')
  })
})
