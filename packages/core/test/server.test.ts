import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { createChatHandler } from '../src/server/handler.js'
import { createRetriever } from '../src/retrieve/retriever.js'
import { createKnowledgeSearch, knowledgeTool } from '../src/tool.js'
import { createAgent } from '../src/agent.js'
import { buildInstructions, contextualQuery, retrievalQuery, toSourceRefs } from '../src/server/prompt.js'
import type { Document, KnowledgeIndex, Match, StreamFrame } from '../src/types.js'

const documents: Document[] = [
  {
    id: 'refunds',
    title: 'Refunds',
    url: 'https://shop.example/refunds',
    text: '# Refunds\n\nWe refund any order within 30 days of delivery. Engraved items are final sale.',
  },
  {
    id: 'shipping',
    title: 'Shipping',
    url: 'https://shop.example/shipping',
    text: '# Shipping\n\nOrders ship within two business days. Delivery to the EU takes about a week.',
  },
]

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({ sources: [textSource(documents)] })
  return cached
}

/** A model that echoes a fixed answer, so tests never touch the network. */
function mockModel(text = 'You have 30 days to request a refund [1].') {
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
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
        chunkDelayInMs: 0,
      }),
    }),
  })
}

async function frames(response: Response): Promise<StreamFrame[]> {
  const body = await response.text()
  return body
    .split('\n\n')
    .filter((part) => part.startsWith('data:'))
    .map((part) => JSON.parse(part.slice(5).trim()) as StreamFrame)
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://api.example/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('prompt', () => {
  it('gives the model an explicit way to say it does not know', async () => {
    const instructions = buildInstructions({ fallback: 'I cannot help with that.' }, [])
    expect(instructions).toContain('I cannot help with that.')
    expect(instructions).toContain('nothing in the documentation matched')
  })

  it('numbers the sources so citations line up', async () => {
    const retriever = createRetriever({ index: await index() })
    const matches = await retriever.retrieve('refund')
    const instructions = buildInstructions({ business: 'Acme' }, matches)
    expect(instructions).toContain('for Acme')
    expect(instructions).toContain('[1]')
  })

  it('emits one citation per source, numbered exactly as the prompt numbers them', () => {
    const chunk = { id: 'a', docId: 'refunds', title: 'Refunds', text: 'x', url: 'https://shop.example/refunds' }
    const matches: Match[] = [
      { chunk, score: 1, from: ['keyword'] },
      { chunk: { ...chunk, id: 'b' }, score: 0.5, from: ['keyword'] },
    ]
    // Two chunks means [1] and [2] in the prompt, so two refs here or a model
    // citing [2] would point at nothing.
    expect(toSourceRefs(matches)).toHaveLength(2)
  })

  it('retrieves on the latest question by itself', () => {
    const query = retrievalQuery([
      { role: 'user', content: 'How long does shipping take to Spain?' },
      { role: 'assistant', content: 'About a week.' },
      { role: 'user', content: 'and refunds?' },
    ])
    expect(query).toBe('and refunds?')
  })

  it('offers the previous question as a fallback for a bare follow-up', () => {
    const query = contextualQuery([
      { role: 'user', content: 'How long does shipping take to Spain?' },
      { role: 'assistant', content: 'About a week.' },
      { role: 'user', content: 'and to Ireland?' },
    ])
    expect(query).toContain('Spain')
    expect(query).toContain('Ireland')
  })

  it('has no fallback on the first turn', () => {
    expect(contextualQuery([{ role: 'user', content: 'hello' }])).toBeNull()
  })
})

describe('retriever', () => {
  it('finds the right page for a plain question', async () => {
    const matches = await createRetriever({ index: await index() }).retrieve('what is the refund window')
    expect(matches[0]?.chunk.docId).toBe('refunds')
  })

  it('documents the keyword-only blind spot: pure paraphrase needs vectors', async () => {
    // "money back" shares no term with "refund", so BM25 cannot connect them.
    // This is the honest limit of the zero-credential path and the reason
    // embeddings exist as a one-flag upgrade rather than a nice-to-have.
    const matches = await createRetriever({ index: await index() }).retrieve('can I get my money back')
    expect(matches).toHaveLength(0)
  })

  it('caps how much of one document can fill the context', async () => {
    const big = await buildIndex({
      sources: [
        textSource([
          { id: 'one', title: 'One', text: `# One\n\n${'refund policy details here. '.repeat(300)}` },
        ]),
      ],
    })
    const matches = await createRetriever({ index: big, maxPerDocument: 2 }).retrieve('refund policy')
    expect(matches.length).toBeLessThanOrEqual(2)
  })

  it('reports keyword-only when the index has no vectors', async () => {
    expect(createRetriever({ index: await index() }).name).toBe('keyword')
  })

  it('ignores a chunk that shares only one word with a long question', async () => {
    const narrow = await buildIndex({
      sources: [
        textSource([
          { id: 'target', title: 'Warranty', text: '# Warranty\n\nWe replace a faulty grinder within twelve months.' },
          { id: 'decoy', title: 'Roasting', text: '# Roasting\n\nWe roast every grinder order on a Monday morning.' },
        ]),
      ],
    })

    // Both pages contain "grinder". Only the warranty page is about the
    // question, and the decoy must not ride in on that single shared word.
    const matches = await createRetriever({ index: narrow }).retrieve(
      'my grinder is faulty, can you replace it under warranty please',
    )
    expect(matches).not.toHaveLength(0)
    expect(matches.every((match) => match.chunk.docId !== 'decoy')).toBe(true)
  })

  it('allows a single matched term when the question is short', async () => {
    const matches = await createRetriever({ index: await index() }).retrieve('shipping')
    expect(matches[0]?.chunk.docId).toBe('shipping')
  })

  it('returns nothing at all for a question the content cannot answer', async () => {
    const matches = await createRetriever({ index: await index() }).retrieve(
      'what is the capital city of Mongolia',
    )
    expect(matches).toHaveLength(0)
  })

  it('drops the weak tail rather than padding the context to topK', async () => {
    const matches = await createRetriever({ index: await index() }).retrieve('refund window')
    // Only two short pages exist, so a full six results would be padding.
    expect(matches.length).toBeLessThan(6)
  })

  it('lets a caller loosen the coverage rule when recall matters more', async () => {
    const loose = createRetriever({ index: await index(), coverageFrom: 99 })
    const strict = createRetriever({ index: await index(), coverageFrom: 2 })
    const question = 'how many business days before an order is delivered to Europe'
    expect((await loose.retrieve(question)).length).toBeGreaterThanOrEqual(
      (await strict.retrieve(question)).length,
    )
  })
})

describe('chat handler', () => {
  it('streams sources before the answer, then the answer, then done', async () => {
    const handle = createChatHandler({ index: await index(), model: mockModel() })
    const result = await frames(await handle(post({ messages: [{ role: 'user', content: 'refund policy?' }] })))

    expect(result[0]?.type).toBe('sources')
    expect(result.some((frame) => frame.type === 'delta')).toBe(true)
    expect(result.at(-1)?.type).toBe('done')
  })

  it('accepts the single-message shape as well as a transcript', async () => {
    const handle = createChatHandler({ index: await index(), model: mockModel() })
    const response = await handle(post({ message: 'refund policy?' }))
    expect(response.status).toBe(200)
    expect(await frames(response)).not.toHaveLength(0)
  })

  it('rejects an empty request rather than calling the model', async () => {
    const handle = createChatHandler({ index: await index(), model: mockModel() })
    expect((await handle(post({ messages: [] }))).status).toBe(400)
  })

  it('rejects a transcript that does not end with the user', async () => {
    const handle = createChatHandler({ index: await index(), model: mockModel() })
    const response = await handle(post({ messages: [{ role: 'assistant', content: 'hi' }] }))
    expect(response.status).toBe(400)
  })

  it('refuses anything but POST and OPTIONS', async () => {
    const handle = createChatHandler({ index: await index(), model: mockModel() })
    const response = await handle(new Request('https://api.example/chat', { method: 'GET' }))
    expect(response.status).toBe(405)
  })

  it('answers a CORS preflight for an allowed origin only', async () => {
    const handle = createChatHandler({
      index: await index(),
      model: mockModel(),
      cors: { allowedOrigins: ['https://shop.example'] },
    })

    const allowed = await handle(
      new Request('https://api.example/chat', { method: 'OPTIONS', headers: { origin: 'https://shop.example' } }),
    )
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://shop.example')

    const blocked = await handle(
      new Request('https://api.example/chat', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
    )
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('rate limits a caller once the window is spent', async () => {
    const handle = createChatHandler({
      index: await index(),
      model: mockModel(),
      rateLimit: { limit: 2, windowMs: 60_000 },
    })
    const headers = { 'x-forwarded-for': '203.0.113.9' }

    await handle(post({ message: 'one' }, headers))
    await handle(post({ message: 'two' }, headers))
    const third = await handle(post({ message: 'three' }, headers))

    expect(third.status).toBe(429)
    expect(third.headers.get('retry-after')).toBeTruthy()
  })

  it('reports a model failure as an error frame instead of a dead stream', async () => {
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('provider exploded')
      },
    })
    const handle = createChatHandler({ index: await index(), model: failing })
    const result = await frames(await handle(post({ message: 'refund?' })))
    expect(result.some((frame) => frame.type === 'error')).toBe(true)
  })

  it('hands the finished exchange to the analytics hook', async () => {
    const seen: Array<{ question: string; answer: string; unanswered: boolean }> = []
    const handle = createChatHandler({
      index: await index(),
      model: mockModel('Thirty days.'),
      onConversation: (event) =>
        void seen.push({ question: event.question, answer: event.answer, unanswered: event.unanswered }),
    })

    await (await handle(post({ message: 'refund policy?' }))).text()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(seen[0]?.question).toBe('refund policy?')
    expect(seen[0]?.answer).toBe('Thirty days.')
    expect(seen[0]?.unanswered).toBe(false)
  })

  it('survives an analytics hook that throws', async () => {
    const handle = createChatHandler({
      index: await index(),
      model: mockModel(),
      onConversation: () => {
        throw new Error('logging is down')
      },
    })
    const response = await handle(post({ message: 'refund?' }))
    expect((await frames(response)).at(-1)?.type).toBe('done')
  })

  it('truncates an abusive message instead of forwarding it', async () => {
    const handle = createChatHandler({
      index: await index(),
      model: mockModel(),
      maxMessageLength: 20,
    })
    const response = await handle(post({ message: 'x'.repeat(10_000) }))
    expect(response.status).toBe(200)
  })
})

describe('citation labels', () => {
  it('shows only the deepest heading, not the whole trail', () => {
    const refs = toSourceRefs([
      {
        chunk: {
          id: 'a',
          docId: 'd',
          title: 'Shipping and delivery',
          section: 'Shipping and delivery > Shipping cost',
          text: 'x',
        },
        score: 1,
        from: ['keyword'],
      },
    ])
    expect(refs[0]?.section).toBe('Shipping cost')
  })

  it('omits the section when it just repeats the title', () => {
    const refs = toSourceRefs([
      { chunk: { id: 'a', docId: 'd', title: 'Refunds', section: 'Refunds', text: 'x' }, score: 1, from: ['keyword'] },
    ])
    expect(refs[0]?.section).toBeUndefined()
  })
})

describe('changing the subject mid-conversation', () => {
  it('does not answer a new question from the previous question’s pages', async () => {
    const handle = createChatHandler({ index: await index(), model: mockModel() })
    const response = await handle(
      post({
        messages: [
          { role: 'user', content: 'How long does shipping to the EU take?' },
          { role: 'assistant', content: 'About a week.' },
          { role: 'user', content: 'What is your refund window?' },
        ],
      }),
    )

    const sources = (await frames(response)).find((frame) => frame.type === 'sources')
    expect(sources?.type === 'sources' && sources.sources.some((ref) => ref.title === 'Refunds')).toBe(true)
    expect(sources?.type === 'sources' && sources.sources.some((ref) => ref.title === 'Shipping')).toBe(false)
  })
})

describe('knowledge tool', () => {
  it('answers a tool call with numbered passages an agent can cite', async () => {
    const search = createKnowledgeSearch({ index: await index() })
    const passages = await search('what is the refund window')

    expect(passages.length).toBeGreaterThan(0)
    expect(passages[0]?.ref).toBe(1)
    expect(passages[0]?.title).toBe('Refunds')
    expect(passages[0]?.url).toBe('https://shop.example/refunds')
    expect(passages[0]?.text).toContain('30 days')
  })

  it('returns an empty list rather than inventing a passage', async () => {
    const search = createKnowledgeSearch({ index: await index() })
    expect(await search('what is the capital of Mongolia')).toEqual([])
  })

  it('exposes an AI SDK tool that any agent framework can call', async () => {
    const built = knowledgeTool({ index: await index() })
    expect(typeof built.execute).toBe('function')
    expect(built.description).toMatch(/help documentation/i)

    const result = await built.execute?.(
      { question: 'what is the refund window' },
      { toolCallId: 't1', messages: [] },
    )
    expect((result as { passages: unknown[] }).passages.length).toBeGreaterThan(0)
  })
})

describe('the agent with no transport attached', () => {
  it('answers a question and returns only the sources it cited', async () => {
    const agent = createAgent({ index: await index(), model: mockModel('Thirty days [1].') })
    const result = await agent.answer('what is the refund window')

    expect(result.text).toBe('Thirty days [1].')
    expect(result.sources).toHaveLength(1)
    expect(result.unanswered).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('reports an unanswerable question rather than guessing', async () => {
    const agent = createAgent({ index: await index(), model: mockModel('I cannot help.') })
    const result = await agent.answer('what is the capital of Mongolia')

    expect(result.unanswered).toBe(true)
    expect(result.matches).toHaveLength(0)
  })

  it('carries conversation history for a bare follow-up', async () => {
    const agent = createAgent({ index: await index(), model: mockModel() })
    const result = await agent.answer('and to Ireland?', [
      { role: 'user', content: 'how long does shipping take?' },
      { role: 'assistant', content: 'Two business days.' },
    ])
    expect(result.matches.length).toBeGreaterThan(0)
  })

  it('surfaces a provider failure instead of returning empty text silently', async () => {
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('provider exploded')
      },
    })
    const result = await createAgent({ index: await index(), model: failing }).answer('refund?')
    expect(result.error).toContain('provider exploded')
    expect(result.text).toBe('')
  })

  it('streams the same answer as frames', async () => {
    const agent = createAgent({ index: await index(), model: mockModel('Thirty days [1].') })
    const collected: string[] = []
    const types: string[] = []

    for await (const frame of agent.stream('what is the refund window')) {
      types.push(frame.type)
      if (frame.type === 'delta') collected.push(frame.text)
    }

    expect(types[0]).toBe('sources')
    expect(types.at(-1)).toBe('done')
    expect(collected.join('')).toBe('Thirty days [1].')
  })

  it('survives being destructured, so it can be passed around as a function', async () => {
    const { answer } = createAgent({ index: await index(), model: mockModel('ok [1]') })
    await expect(answer('refund window')).resolves.toMatchObject({ text: 'ok [1]' })
  })

  it('exposes retrieval on its own for callers that do their own prompting', async () => {
    const { search } = createAgent({ index: await index() })
    const matches = await search('refund window')
    expect(matches[0]?.chunk.docId).toBe('refunds')
  })
})
