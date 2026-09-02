import { describe, expect, it } from 'vitest'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
const index = async () =>
  (cached ??= await buildIndex({
    sources: [textSource([{ id: 'returns', title: 'Returns', text: 'We refund any order within 30 days of delivery.' }])],
  }))

/** Runs with whatever the environment has, then puts it back. */
async function withoutGateway<T>(run: () => Promise<T>): Promise<T> {
  const had = { key: process.env.AI_GATEWAY_API_KEY, oidc: process.env.VERCEL_OIDC_TOKEN }
  delete process.env.AI_GATEWAY_API_KEY
  delete process.env.VERCEL_OIDC_TOKEN

  try {
    return await run()
  } finally {
    if (had.key !== undefined) process.env.AI_GATEWAY_API_KEY = had.key
    if (had.oidc !== undefined) process.env.VERCEL_OIDC_TOKEN = had.oidc
  }
}

describe('the first thing anybody writes', () => {
  it('answers with the passages rather than an empty string', async () => {
    const { text, sources } = await withoutGateway(async () =>
      createAgent({ index: await index() }).answer('how do I get my money back?'),
    )

    // What it did before: one doomed request to Vercel's gateway per turn, an
    // authentication failure in the logs, and an empty answer for the customer.
    // The README promises this path works with no account and no key.
    expect(text).not.toBe('')
    expect(text).toContain('no model is configured')
    expect(text).toContain('30 days')
    expect(sources.map((source) => source.title)).toContain('Returns')
  })

  it('says how to fix it, in the two ways there are', async () => {
    const { text } = await withoutGateway(async () =>
      createAgent({ index: await index() }).answer('how do I get my money back?'),
    )

    expect(text).toContain('model')
    expect(text).toContain('AI_GATEWAY_API_KEY')
  })

  it('does not take this path when a model was given', async () => {
    const { MockLanguageModelV4 } = await import('ai/test')
    const { simulateReadableStream } = await import('ai')

    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '0' },
            { type: 'text-delta' as const, id: '0', delta: 'You have 30 days.' },
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

    const { text } = await withoutGateway(async () =>
      createAgent({ index: await index(), model }).answer('how do I get my money back?'),
    )

    expect(text).toBe('You have 30 days.')
  })
})

describe('a turn with no model is still a whole turn', () => {
  it('records what was asked and what was said', async () => {
    const { memoryStore } = await import('../src/store/memory.js')
    const store = memoryStore()

    await withoutGateway(async () =>
      createAgent({ index: await index(), store }).answer('how do I get my money back?', [], {
        conversationId: 'c1',
      }),
    )

    const thread = await store.getConversation('c1')

    // My first attempt returned early and skipped this entirely, so the
    // conversation simply did not exist afterwards. A turn the customer had is
    // a turn the transcript has to show, whatever answered it.
    expect(thread?.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(thread?.messages[1]?.content).toContain('30 days')
  })

  it('emits exactly one done frame', async () => {
    const frames: string[] = []

    await withoutGateway(async () => {
      for await (const frame of createAgent({ index: await index() }).stream('how do I get my money back?')) {
        frames.push(frame.type)
      }
    })

    // The early return yielded its own on top of the one the normal path
    // yields, so a client counting them saw the turn end twice.
    expect(frames.filter((type) => type === 'done')).toHaveLength(1)
  })

  it('tells the webhooks the turn happened', async () => {
    const fired: string[] = []

    await withoutGateway(async () =>
      createAgent({
        index: await index(),
        webhooks: { emit: (event: string) => void fired.push(event) } as never,
      }).answer('how do I get my money back?'),
    )

    expect(fired).toContain('conversation.answered')
  })
})
