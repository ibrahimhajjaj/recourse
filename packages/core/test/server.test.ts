import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { createChatHandler } from '../src/server/handler.js'
import { memoryStore } from '../src/store/memory.js'
import { createRetriever } from '../src/retrieve/retriever.js'
import { createKnowledgeSearch, knowledgeTool } from '../src/tool.js'
import { createAgent } from '../src/agent.js'
import { buildInstructions, contextualQuery, retrievalQuery, toSourceRefs, toneRules } from '../src/server/prompt.js'
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
    const instructions = buildInstructions({ persona: { fallback: 'I cannot help with that.' }, matches: [] })
    expect(instructions).toContain('I cannot help with that.')
    expect(instructions).toContain('nothing in the documentation matched')
  })

  // Six evenings of live defects were one defect: a global "when you cannot
  // answer, say this and stop" sitting at the same level as everything else,
  // winning every argument it was allowed to have. Each fix was an exception
  // fencing it off. The fallback now lives inside the one branch it belongs
  // to, so these assert containment rather than ordering.
  describe('the fallback stays in its branch', () => {
    const built = (extra: Partial<Parameters<typeof buildInstructions>[0]> = {}) =>
      buildInstructions({ matches: [], persona: { fallback: 'FALLBACK_MARKER' }, ...extra })

    it('names the fallback once, inside the step about looking something up', () => {
      const instructions = built()
      const occurrences = instructions.split('FALLBACK_MARKER').length - 1
      expect(occurrences).toBe(1)

      const lookup = instructions.indexOf('4. Asking something you could look up')
      const fallbackAt = instructions.indexOf('FALLBACK_MARKER')
      expect(lookup).toBeGreaterThan(-1)
      expect(fallbackAt).toBeGreaterThan(lookup)
    })

    it('keeps it inside step 4 when actions exist too', () => {
      const instructions = built({
        actions: [{ name: 'look_up_order', whenToUse: 'when they ask about an order', parameters: {} }],
      })
      const lookup = instructions.indexOf('4. Asking something you could look up')
      expect(instructions.indexOf('FALLBACK_MARKER')).toBeGreaterThan(lookup)
    })

    // Each of these was its own defect and its own patch. They are branches now.
    it('has a branch for each thing that used to be refused', () => {
      const instructions = built()
      expect(instructions).toContain('1. Saying hello, thank you or goodbye')
      expect(instructions).toContain('2. Asking about you')
      expect(instructions).toContain('3. Asking for something you will never do')
      expect(instructions).toContain('4. Asking something you could look up')
    })

    it('says what it is in the opening line as well as in its own branch', () => {
      const instructions = built()
      const opening = instructions.slice(0, instructions.indexOf('\n'))
      // Primacy and recency both, since this is the one a regulator cares about.
      expect(opening).toContain('AI assistant')
      expect(instructions.indexOf('never a human')).toBeGreaterThan(opening.length)
    })

    it('tells it to handle each part of a message on its own', () => {
      expect(built()).toContain('handle each part on its own')
    })

    // Live: "please contact us for password assistance", to somebody who was
    // contacting us. Exact strings, because the concept was ignored.
    it('bans the exact phrases rather than describing them', () => {
      const instructions = built()
      for (const phrase of ['contact us', 'reach out to us', 'get in touch with us']) {
        expect(instructions).toContain(`"${phrase}"`)
      }
    })
  })

  it('numbers the sources so citations line up', async () => {
    const retriever = createRetriever({ index: await index() })
    const matches = await retriever.retrieve('refund')
    const instructions = buildInstructions({ persona: { business: 'Acme' }, matches })
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
    expect(result.error).toBeTruthy()
    expect(result.text).toBe('')
    // Said in a sentence, with a reference the operator can grep the log for.
    expect(result.error).toMatch(/reference [a-z0-9]{6}/)
    expect(result.error).not.toContain('provider exploded')
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

describe('identity on the chat endpoint', () => {
  const SECRET = 'server-side-secret'

  it('rejects an unverified visitor when verification is required', async () => {
    const handle = createChatHandler({
      index: await index(),
      model: mockModel(),
      identity: { secret: SECRET, required: true },
    })
    const response = await handle(post({ message: 'hi', userId: 'u1', userHash: 'x'.repeat(64) }))
    expect(response.status).toBe(401)
  })

  it('lets a correctly signed visitor through', async () => {
    const { signIdentity } = await import('../src/identity.js')
    const handle = createChatHandler({
      index: await index(),
      model: mockModel(),
      identity: { secret: SECRET, required: true },
    })
    const response = await handle(
      post({ message: 'refund?', userId: 'u1', userHash: await signIdentity('u1', SECRET) }),
    )
    expect(response.status).toBe(200)
  })

  it('serves anonymous visitors when verification is not required', async () => {
    const handle = createChatHandler({
      index: await index(),
      model: mockModel(),
      identity: { secret: SECRET },
    })
    expect((await handle(post({ message: 'refund?' }))).status).toBe(200)
  })
})

describe('feedback on the chat endpoint', () => {
  async function withStore() {
    const { memoryStore } = await import('../src/store/index.js')
    const store = memoryStore()
    const handle = createChatHandler({ index: await index(), model: mockModel('Thirty days.'), store })
    await (await handle(post({ message: 'refund window?', conversationId: 'c1' }))).text()
    // The store write happens as the stream finishes.
    await new Promise((resolve) => setTimeout(resolve, 20))
    return { store, handle }
  }

  it('records a thumb against the answer the visitor rated', async () => {
    const { store, handle } = await withStore()

    const response = await handle(
      post({ feedback: { conversationId: 'c1', messageIndex: 1, value: 'positive' } }),
    )
    expect(response.status).toBe(204)

    const found = await store.getConversation('c1')
    expect(found?.messages.find((m) => m.role === 'assistant')?.feedback).toBe('positive')
  })

  it('shows up in the stats a support lead reads', async () => {
    const { store, handle } = await withStore()
    await handle(post({ feedback: { conversationId: 'c1', messageIndex: 1, value: 'negative' } }))
    expect((await store.stats()).thumbsDown).toBe(1)
  })

  it('rejects a malformed feedback payload', async () => {
    const { handle } = await withStore()
    expect((await handle(post({ feedback: { conversationId: 'c1' } }))).status).toBe(400)
    expect((await handle(post({ feedback: { conversationId: 'c1', messageIndex: 1, value: 'meh' } }))).status).toBe(
      400,
    )
  })

  it('404s an unknown conversation rather than inventing one', async () => {
    const { handle } = await withStore()
    const response = await handle(post({ feedback: { conversationId: 'nope', messageIndex: 1, value: 'positive' } }))
    expect(response.status).toBe(404)
  })

  it('explains itself when no store is configured', async () => {
    const handle = createChatHandler({ index: await index(), model: mockModel() })
    const response = await handle(post({ feedback: { conversationId: 'c1', messageIndex: 1, value: 'positive' } }))
    expect(response.status).toBe(501)
  })
})

describe('client action results coming back from the browser', () => {
  it('feeds what the page returned into the next answer', async () => {
    const seen: string[] = []
    const capturing = new MockLanguageModelV4({
      doStream: async (opts) => {
        seen.push(JSON.stringify(opts.prompt))
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: '0' },
              { type: 'text-delta' as const, id: '0', delta: 'You have 2 items.' },
              { type: 'text-end' as const, id: '0' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop', raw: 'stop' } as const,
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
            ],
            chunkDelayInMs: 0,
          }),
        }
      },
    })

    const handle = createChatHandler({ index: await index(), model: capturing })
    await (
      await handle(
        post({
          message: 'what is in my cart',
          actionResults: [{ name: 'read_cart', output: { items: 2 } }],
        }),
      )
    ).text()

    expect(seen[0]).toContain('read_cart')
    expect(seen[0]).toContain('items')
  })

  it('ignores a flood of results from a hostile page', async () => {
    const handle = createChatHandler({ index: await index(), model: mockModel() })
    const response = await handle(
      post({
        message: 'hi',
        actionResults: Array.from({ length: 50 }, (_, i) => ({ name: `a${i}`, output: 'x' })),
      }),
    )
    expect(response.status).toBe(200)
  })
})

describe('citing when there is nothing to cite', () => {
  it('tells the model not to cite when retrieval found nothing', () => {
    // A citation with nothing behind it invites the reader to check something
    // that does not exist. Models reach for [1] out of habit.
    const instructions = buildInstructions({ matches: [] })

    expect(instructions).toContain('Do not write [1]')
    expect(instructions).toContain('nothing in the documentation matched')
  })

  it('says nothing of the sort when there are sources', async () => {
    const built = await index()
    const retriever = createRetriever({ index: built, topK: 3 })
    const matches = await retriever.retrieve('how do refunds work?')

    expect(matches.length).toBeGreaterThan(0)
    expect(buildInstructions({ matches })).not.toContain('Do not write [1]')
  })
})

describe('a visitor asking to be forgotten', () => {
  it('deletes the conversation from the store', async () => {
    const store = memoryStore()
    await store.appendMessage('c_abc', {
      id: 'm1',
      role: 'user',
      content: 'my phone number is 07700 900123',
      createdAt: new Date().toISOString(),
    }, { channel: 'web' })

    const handler = createChatHandler({ index: await index(), model: mockModel(), embedder: false, store })
    const response = await handler(
      new Request('https://example.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteConversation: 'c_abc' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true })
    expect(await store.getConversation('c_abc')).toBeNull()
  })

  it('says so plainly when there was nothing to delete', async () => {
    const handler = createChatHandler({
      index: await index(),
      model: mockModel(),
      embedder: false,
      store: memoryStore(),
    })

    const response = await handler(
      new Request('https://example.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteConversation: 'never-existed' }),
      }),
    )

    expect(await response.json()).toEqual({ deleted: false })
  })

  it('does not fall through to answering a question', async () => {
    let asked = 0
    const model = new MockLanguageModelV4({
      doStream: async () => {
        asked++
        throw new Error('a deletion must never reach the model')
      },
    })
    const handler = createChatHandler({ index: await index(), model, embedder: false, store: memoryStore() })

    await handler(
      new Request('https://example.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteConversation: 'c_abc', message: 'and also, where is my order?' }),
      }),
    )

    // A deletion is not a turn. Answering one would put the words back.
    expect(asked).toBe(0)
  })
})

describe('how much voice a tone may carry', () => {
  const rules = (n: number) =>
    Array.from({ length: n }, (_, i) => `- Rule number ${i + 1}.`).join('\n')

  it('keeps a tone written as a document, and only its rules', () => {
    const document = [
      '# Night shift',
      '',
      'For the hours when nobody is at a desk.',
      '',
      '- Say when the office opens again.',
      '- Do not promise a callback before then.',
    ].join('\n')

    expect(toneRules(document)).toEqual([
      '- Say when the office opens again.',
      '- Do not promise a callback before then.',
    ])
  })

  it('caps a tone that is really a system prompt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(toneRules(rules(25))).toHaveLength(12)
    warn.mockRestore()
  })

  // Silently dropping them is the worst outcome: the tone looks applied, most
  // of it is, and the missing half only surfaces when somebody notices a rule
  // being ignored that they are certain they wrote.
  it('says so rather than dropping the rest quietly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    toneRules(rules(25))

    expect(warn).toHaveBeenCalledTimes(1)
    const said = String(warn.mock.calls[0]?.[0])
    expect(said).toContain('25 rules')
    expect(said).toContain('first 12')
    warn.mockRestore()
  })

  it('stays quiet for a tone within the cap', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    toneRules(rules(4))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('leaves the built-in names alone', () => {
    expect(toneRules('warm').length).toBeGreaterThan(0)
    expect(toneRules(undefined)).toEqual([])
  })
})
