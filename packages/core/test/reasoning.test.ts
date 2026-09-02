import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { memoryStore } from '../src/store/memory.js'
import type { KnowledgeIndex, StreamFrame } from '../src/types.js'

let cached: KnowledgeIndex | null = null
const index = async () =>
  (cached ??= await buildIndex({
    sources: [textSource([{ id: 'refunds', title: 'Refunds', text: 'We refund any order within 30 days.' }])],
  }))

/** What the prompt told it not to do is exactly what a model thinks about. */
const THOUGHT = 'The instructions say never to offer a discount. They sound annoyed though.'

const thinker = () =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'reasoning-start' as const, id: 'r' },
          { type: 'reasoning-delta' as const, id: 'r', delta: THOUGHT },
          { type: 'reasoning-end' as const, id: 'r' },
          { type: 'text-start' as const, id: '0' },
          { type: 'text-delta' as const, id: '0', delta: 'You have 30 days to request a refund.' },
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

const collect = async (frames: AsyncIterable<StreamFrame>) => {
  const out: StreamFrame[] = []
  for await (const frame of frames) out.push(frame)
  return out
}

describe('a model that thinks out loud', () => {
  it('says nothing about its thinking unless asked', async () => {
    const agent = createAgent({ index: await index(), model: thinker() })
    const frames = await collect(agent.stream('can I get a refund?'))

    // The default matters more than the feature. This is the model restating
    // its own instructions, and the reader is a member of the public.
    expect(frames.some((frame) => frame.type === 'reasoning')).toBe(false)
    expect(JSON.stringify(frames)).not.toContain('never to offer a discount')
  })

  it('streams it on its own channel when a deployment asks', async () => {
    const agent = createAgent({ index: await index(), model: thinker(), reasoning: true })
    const frames = await collect(agent.stream('can I get a refund?'))

    const thoughts = frames.filter((frame) => frame.type === 'reasoning')
    expect(thoughts).toHaveLength(1)
    expect((thoughts[0] as { text: string }).text).toBe(THOUGHT)
  })

  it('never lets the thinking become the answer', async () => {
    const agent = createAgent({ index: await index(), model: thinker(), reasoning: true })
    const { text } = await agent.answer('can I get a refund?')

    expect(text).toBe('You have 30 days to request a refund.')
    expect(text).not.toContain('discount')
  })

  it('does not write the thinking into the transcript', async () => {
    const store = memoryStore()
    const agent = createAgent({ index: await index(), model: thinker(), reasoning: true, store })

    await agent.answer('can I get a refund?', [], { conversationId: 'c1' })

    const thread = await store.getConversation('c1')
    // Stored, it would be read by anybody with access to the inbox, exported
    // with the transcript, and summarised into the conversation's title.
    expect(JSON.stringify(thread?.messages ?? [])).not.toContain('discount')
  })

  it('keeps the thinking away from an answer filter', async () => {
    const seen: string[] = []
    const { createHooks } = await import('../src/hooks.js')
    const hooks = createHooks()
    hooks.filter('answer', () => ({
      push: (text: string) => {
        seen.push(text)
        return text
      },
      flush: () => '',
    }))

    const agent = createAgent({ index: await index(), model: thinker(), reasoning: true, hooks })
    await agent.answer('can I get a refund?')

    expect(seen.join('')).not.toContain('discount')
  })
})
