import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { sunshineChannel } from '../src/channels/index.js'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { memoryStore } from '../src/store/index.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [
      textSource([
        { id: 'refunds', title: 'Refunds', text: '# Refunds\n\nWe refund any order within 30 days of delivery.' },
      ]),
    ],
  })
  return cached
}

function model(text = 'We refund within 30 days [1].') {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: '0' },
          { type: 'text-delta' as const, id: '0', delta: text },
          { type: 'text-end' as const, id: '0' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop', raw: 'stop' } as const,
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
        chunkDelayInMs: 0,
      }),
    }),
  })
}

function collector() {
  const pending: Promise<unknown>[] = []
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), settled: () => Promise.all(pending) }
}

async function agentFor(store = memoryStore()) {
  return { agent: createAgent({ index: await index(), model: model(), store }), store }
}

const base = { webhookSecret: 'shh', appId: 'app-1', keyId: 'key', keySecret: 'secret' }

/** The envelope Sunshine documents, with the parts this adapter reads. */
function event(overrides: Record<string, unknown> = {}, message: Record<string, unknown> = {}) {
  return {
    app: { id: 'app-1' },
    webhook: { id: 'w1', version: 'v2' },
    events: [
      {
        id: 'e1',
        type: 'conversation:message',
        payload: {
          conversation: { id: 'conv-1', type: 'personal' },
          message: {
            id: 'm1',
            author: { userId: 'u1', displayName: 'Steve Rogers', type: 'user' },
            content: { type: 'text', text: 'do you do refunds?' },
            source: { type: 'telegram', integrationId: 'i1' },
            ...message,
          },
        },
        ...overrides,
      },
    ],
  }
}

function post(body: unknown, secret = 'shh') {
  return new Request('https://shop.example/webhooks/sunshine', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': secret },
    body: JSON.stringify(body),
  })
}

describe('Sunshine Conversations', () => {
  it('refuses a request without the secret, which is the whole of the check', async () => {
    const { agent } = await agentFor()
    const handle = sunshineChannel({ agent, ...base })

    const response = await handle(
      new Request('https://shop.example/webhooks/sunshine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event()),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('refuses the wrong secret', async () => {
    const { agent } = await agentFor()
    const handle = sunshineChannel({ agent, ...base })
    expect((await handle(post(event(), 'not-it'))).status).toBe(401)
  })

  it('answers a customer message and replies on the conversation', async () => {
    const sent: Array<{ conversationId: string; text: string }> = []
    const { agent } = await agentFor()
    const pending = collector()

    const handle = sunshineChannel({
      agent,
      ...base,
      waitUntil: pending.waitUntil,
      send: async (conversationId, text) => void sent.push({ conversationId, text }),
    })

    expect((await handle(post(event()))).status).toBe(200)
    await pending.settled()

    expect(sent[0]?.conversationId).toBe('conv-1')
    expect(sent[0]?.text).toContain('30 days')
  })

  // Everything the business says comes back through the same webhook, this
  // agent's own replies included.
  it('never answers itself', async () => {
    const sent: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = sunshineChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => void sent.push(1) })

    await handle(post(event({}, { author: { type: 'business', subtypes: ['AI'] } })))
    await pending.settled()
    expect(sent).toEqual([])
  })

  it('ignores the events that are not a message', async () => {
    const sent: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = sunshineChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => void sent.push(1) })

    await handle(post(event({ type: 'conversation:typing' })))
    await handle(post(event({ type: 'conversation:read' })))
    await pending.settled()
    expect(sent).toEqual([])
  })

  it('answers every message in a batch, since one delivery can carry several', async () => {
    const sent: unknown[] = []
    const { agent } = await agentFor()
    const pending = collector()
    const handle = sunshineChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => void sent.push(1) })

    const two = event()
    two.events.push(JSON.parse(JSON.stringify(two.events[0])))
    two.events[1]!.payload.conversation.id = 'conv-2'

    await handle(post(two))
    await pending.settled()
    expect(sent).toHaveLength(2)
  })

  it('still answers 200 for a body it cannot parse, or Sunshine retries five times', async () => {
    const { agent } = await agentFor()
    const handle = sunshineChannel({ agent, ...base })
    const response = await handle(
      new Request('https://shop.example/webhooks/sunshine', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'shh' },
        body: '{not json',
      }),
    )
    expect(response.status).toBe(200)
  })

  it('keeps one conversation per Sunshine conversation, whatever channel it came in on', async () => {
    const { agent, store } = await agentFor()
    const pending = collector()
    const handle = sunshineChannel({ agent, ...base, waitUntil: pending.waitUntil, send: async () => {} })

    await handle(post(event()))
    await pending.settled()
    // A follow-up arriving over a different underlying channel is the same
    // person in the same conversation, and Sunshine says so by reusing the id.
    await handle(post(event({}, { content: { type: 'text', text: 'and to the UK?' }, source: { type: 'whatsapp' } })))
    await pending.settled()

    const found = await store.getConversation('sunshine:conv-1')
    expect(found?.messages.filter((m) => m.role === 'user')).toHaveLength(2)
  })
})

describe('telling a Sunshine customer they are talking to AI', () => {
  it('marks the message as AI so Sunshine appends its own disclaimer', async () => {
    const posted: any[] = []
    const { agent } = await agentFor()
    const pending = collector()

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      posted.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response('{}', { status: 201 })
    })

    const handle = sunshineChannel({ agent, ...base, waitUntil: pending.waitUntil })
    await handle(post(event()))
    await pending.settled()
    spy.mockRestore()

    // Sunshine does the disclosure per channel, in the customer's own client.
    // Doing it ourselves as well would say it twice.
    expect(posted[0]?.author).toEqual({ type: 'business', subtypes: ['AI'] })
  })

  it('leaves the subtype off when asked, for a deployment doing it another way', async () => {
    const posted: any[] = []
    const { agent } = await agentFor()
    const pending = collector()

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      posted.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response('{}', { status: 201 })
    })

    const handle = sunshineChannel({ agent, ...base, aiDisclaimer: false, waitUntil: pending.waitUntil })
    await handle(post(event()))
    await pending.settled()
    spy.mockRestore()

    expect(posted[0]?.author).toEqual({ type: 'business' })
  })

  it('posts to the conversation the documented way', async () => {
    const urls: string[] = []
    const { agent } = await agentFor()
    const pending = collector()

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      urls.push(String(input))
      return new Response('{}', { status: 201 })
    })

    const handle = sunshineChannel({ agent, ...base, waitUntil: pending.waitUntil })
    await handle(post(event()))
    await pending.settled()
    spy.mockRestore()

    expect(urls[0]).toBe('https://api.smooch.io/v2/apps/app-1/conversations/conv-1/messages')
  })
})
