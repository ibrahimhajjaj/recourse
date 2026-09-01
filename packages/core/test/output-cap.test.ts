import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { createAgent } from '../src/agent.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
async function index(): Promise<KnowledgeIndex> {
  cached ??= await buildIndex({
    sources: [textSource([{ id: 'hours', title: 'Hours', text: 'We are open nine to five, Monday to Friday.' }])],
    embed: false,
  })

  return cached
}

/** The provider-protocol usage shape, which is nested rather than flat. */
const used = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
}

/** A model that records the options it was called with. */
function watching(calls: Array<Record<string, unknown>>) {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      calls.push(options as unknown as Record<string, unknown>)

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '0' },
            { type: 'text-delta' as const, id: '0', delta: 'Nine to five.' },
            { type: 'text-end' as const, id: '0' },
            { type: 'finish' as const, finishReason: { unified: 'stop', raw: 'stop' } as const, usage: used },
          ],
          chunkDelayInMs: 0,
        }),
      }
    },
  })
}

const ask = async (agent: ReturnType<typeof createAgent>) => {
  for await (const _ of agent.stream([{ role: 'user', content: 'when are you open?' }])) void _
}

describe('capping how much the model says', () => {
  it('leaves the ceiling off unless one is asked for', async () => {
    // A truncated sentence reads worse than a long one, so this is opt-in.
    const calls: Array<Record<string, unknown>> = []
    await ask(createAgent({ index: await index(), model: watching(calls), classifier: false }))

    expect(calls[0]?.maxOutputTokens).toBeUndefined()
  })

  it('passes the ceiling through when one is given', async () => {
    // The reason it exists: on a call the answer is read aloud and a wordy
    // paragraph is half a minute of somebody waiting for their turn.
    const calls: Array<Record<string, unknown>> = []
    await ask(createAgent({ index: await index(), model: watching(calls), classifier: false, maxOutputTokens: 120 }))

    expect(calls[0]?.maxOutputTokens).toBe(120)
  })
})
