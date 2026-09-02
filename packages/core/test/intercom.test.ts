import { describe, expect, it } from 'vitest'
import { intercomChannel } from '../src/channels/intercom.js'
import { signIntercom } from '../src/channels/verify.js'
import { buildIndex, textSource } from '../src/index.js'
import { createAgent } from '../src/agent.js'
import { memoryStore } from '../src/store/memory.js'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'

const SECRET = 'client-secret-abcdef'

function model(text = 'Two working days.') {
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
  } as ConstructorParameters<typeof MockLanguageModelV4>[0])
}

async function agentFor(store = memoryStore()) {
  const index = await buildIndex({
    sources: [
      textSource([
        { id: 'shipping', title: 'Shipping', url: 'https://shop.example/s', text: 'Delivery takes two working days.' },
      ]),
    ],
  })

  return createAgent({ index, model: model(), embedder: false, store })
}

function collector() {
  const waiting: Array<Promise<unknown>> = []
  return { waitUntil: (work: Promise<unknown>) => void waiting.push(work), settled: () => Promise.allSettled(waiting) }
}

async function post(body: unknown, options: { sign?: boolean } = {}) {
  const sent: Array<{ conversationId: string; text: string }> = []
  const pending = collector()
  const raw = JSON.stringify(body)
  const store = memoryStore()

  const handle = intercomChannel({
    agent: await agentFor(store),
    clientSecret: SECRET,
    accessToken: 'token',
    adminId: 'admin_1',
    waitUntil: pending.waitUntil,
    send: async (conversationId, text) => void sent.push({ conversationId, text }),
  })

  const response = await handle(
    new Request('https://shop.example/webhooks/intercom', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.sign === false ? {} : { 'x-hub-signature': await signIntercom(raw, SECRET) }),
      },
      body: raw,
    }),
  )

  await pending.settled()

  // What the customer was understood to have said, read back off the
  // transcript rather than from a spy on a private function.
  const asked = async (conversationId: string): Promise<string | undefined> => {
    const thread = await store.getConversation(`intercom:${conversationId}`)
    return thread?.messages.find((message) => message.role === 'user')?.content
  }

  return { status: response.status, sent, asked }
}

const started = (body: string) => ({
  topic: 'conversation.user.created',
  data: { item: { id: 'c1', source: { body, author: { type: 'user', id: 'u1', name: 'Sam' } } } },
})

describe('Intercom', () => {
  it('answers a conversation a customer started', async () => {
    const { status, sent } = await post(started('<p>How long is delivery?</p>'))

    expect(status).toBe(200)
    expect(sent[0]?.conversationId).toBe('c1')
    expect(sent[0]?.text).toContain('Two working days')
  })

  it('refuses a body that is not signed with the client secret', async () => {
    const { status, sent } = await post(started('<p>hello</p>'), { sign: false })

    expect(status).toBe(401)
    expect(sent).toEqual([])
  })

  it('reads the newest part of a reply, not the whole thread', async () => {
    const { sent } = await post({
      topic: 'conversation.user.replied',
      data: {
        item: {
          id: 'c2',
          source: { body: '<p>the first thing they asked</p>', author: { type: 'user', id: 'u1' } },
          conversation_parts: {
            conversation_parts: [
              { body: '<p>an earlier answer</p>', author: { type: 'admin', id: 'a1' } },
              { body: '<p>and how long is delivery?</p>', author: { type: 'user', id: 'u1' } },
            ],
          },
        },
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.conversationId).toBe('c2')
  })

  it('does not answer its own reply, which is how a loop starts', async () => {
    // The parts include what the agent said, so the author decides. Without
    // this the agent answers itself until somebody notices the bill.
    const { status, sent } = await post({
      topic: 'conversation.user.replied',
      data: {
        item: {
          id: 'c3',
          conversation_parts: {
            conversation_parts: [{ body: '<p>Two working days.</p>', author: { type: 'admin', id: 'admin_1' } }],
          },
        },
      },
    })

    expect(status).toBe(200)
    expect(sent).toEqual([])
  })

  it('ignores the topics it was not asked about', async () => {
    const { sent } = await post({ topic: 'conversation.admin.closed', data: { item: { id: 'c4' } } })
    expect(sent).toEqual([])
  })

  it('reads the message out of the markup the messenger wraps it in', async () => {
    const { asked } = await post(
      started('<p>Hello there,</p><p>how long is delivery to <b>Ireland</b>?</p><p>Thanks &amp; bye</p>'),
    )

    // Paragraphs become breaks rather than nothing, or two of them run
    // together into one word and the question stops making sense.
    expect(await asked('c1')).toBe('Hello there,\nhow long is delivery to Ireland?\nThanks & bye')
  })

  it('decodes entities after stripping, not before', async () => {
    // Decoding first turns a written-out &lt;b&gt; into a tag that the
    // stripper then eats, losing text the customer actually typed.
    const { asked } = await post(started('<p>is &lt;b&gt; allowed in a name?</p>'))
    expect(await asked('c1')).toBe('is <b> allowed in a name?')
  })
})
