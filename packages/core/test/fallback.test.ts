import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { defineAction } from '../src/actions/index.js'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [textSource([{ id: 'refunds', title: 'Refunds', text: '# Refunds\n\nRefunds take 30 days.' }])],
  })
  return cached
}

describe('falling back to a second model', () => {
  function talking(text: string) {
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

  function failing(message: string) {
    return new MockLanguageModelV4({
      doStream: async () => {
        throw new Error(message)
      },
    })
  }

  it('answers on the second model when the first is rate limited', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const agent = createAgent({
      index: await index(),
      model: failing('429 rate limit'),
      fallbackModel: talking('Refunds take 30 days [1].'),
      embedder: false,
    })

    const result = await agent.answer('refunds?')
    expect(result.text).toContain('30 days')
    expect(result.error).toBeUndefined()
    warn.mockRestore()
  })

  it('does not retry a failure a second model would repeat', async () => {
    let fallbackCalls = 0
    const fallback = new MockLanguageModelV4({
      doStream: async () => {
        fallbackCalls++
        return talking('never reached').doStream({} as never) as never
      },
    })

    const agent = createAgent({
      index: await index(),
      model: failing('invalid request: messages must not be empty'),
      fallbackModel: fallback,
      embedder: false,
    })

    const result = await agent.answer('refunds?')
    expect(fallbackCalls).toBe(0)
    expect(result.error).toBeTruthy()
  })

  it('does not run actions twice when it falls back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let charged = 0

    // Calls the action on its first step, then dies on the step after, which
    // is exactly the case a naive retry would bill twice.
    let step = 0
    const halfway = new MockLanguageModelV4({
      doStream: async () => {
        if (step++ > 0) throw new Error('429 rate limit')
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'tool-input-start' as const, id: 't1', toolName: 'charge' },
              { type: 'tool-input-end' as const, id: 't1' },
              { type: 'tool-call' as const, toolCallId: 't1', toolName: 'charge', input: '{}' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'tool-calls', raw: 'tool_calls' } as const,
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ],
            chunkDelayInMs: 0,
          }),
        }
      },
    })

    const agent = createAgent({
      index: await index(),
      model: halfway,
      fallbackModel: talking('done'),
      embedder: false,
      actions: [
        defineAction({
          name: 'charge',
          whenToUse: 'x',
          execute: async () => {
            charged++
            return { ok: true }
          },
        }),
      ],
    })

    await agent.answer('refunds?')
    expect(charged).toBe(1)
    warn.mockRestore()
  })
})
