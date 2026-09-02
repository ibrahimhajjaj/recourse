import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import type { KnowledgeIndex } from '../src/types.js'

let cached: KnowledgeIndex | null = null
const index = async () =>
  (cached ??= await buildIndex({
    sources: [textSource([{ id: 'faq', title: 'FAQ', text: 'We are open nine to five, Monday to Friday.' }])],
  }))

/**
 * A model that has decided on one tool call and will not be talked out of it.
 *
 * `vary` makes it change an argument every time, which is the spin a signature
 * check cannot see: every call hashes differently, so nothing is ever a repeat.
 */
function stuck(vary: boolean) {
  let call = 0

  return new MockLanguageModelV4({
    doStream: async () => {
      call++
      const id = `c${call}`

      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'tool-call' as const, toolCallId: id, toolName: 'lookup_order', input: JSON.stringify({ order: vary ? `LUM-${call}` : 'LUM-1' }) },
            {
              type: 'finish' as const,
              finishReason: { unified: 'tool-calls', raw: 'tool-calls' } as const,
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
          chunkDelayInMs: 0,
        }),
      }
    },
  })
}

async function spin(vary: boolean) {
  let ran = 0
  const model = stuck(vary)

  const agent = createAgent({
    index: await index(),
    model,
    actions: [
      {
        name: 'lookup_order',
        whenToUse: 'Look an order up.',
        collect: [{ name: 'order', description: 'the order number', required: true }],
        execute: async () => {
          ran++
          throw new Error('no such order')
        },
      },
    ],
  })

  await agent.answer('where is order LUM-1?')

  return { ran, asked: (model as unknown as { doStreamCalls: unknown[] }).doStreamCalls?.length ?? 0 }
}

describe('a model that will not stop calling the same thing', () => {
  it('runs it twice, then refuses, and the turn still ends', async () => {
    const { ran } = await spin(false)

    // Two, not two hundred. The second is allowed on purpose: a model retrying
    // once after a transient failure is doing the right thing.
    expect(ran).toBe(2)
  })

  it('is still bounded when every call is a little different', async () => {
    // The case a signature check cannot catch: nothing repeats, so nothing
    // trips. The step cap is what stops it, and it has to, or this is somebody
    // paying for an unbounded number of round trips to their own API.
    const { ran } = await spin(true)

    // Three real requests to somebody's order system, not six. The step cap
    // alone allowed six, and by the fourth the model has learnt nothing it did
    // not know after the first.
    expect(ran).toBe(3)
  })
})

describe('an action that is working', () => {
  it('is not capped for being called often', async () => {
    // The cap counts failures, not calls. An agent looking up six different
    // orders in one turn is doing exactly what it was asked to, and stopping it
    // would break the flows procedures exist to run.
    let ran = 0
    let call = 0

    const model = new MockLanguageModelV4({
      doStream: async () => {
        call++

        return {
          stream: simulateReadableStream({
            chunks:
              call <= 5
                ? [
                    { type: 'tool-call' as const, toolCallId: `c${call}`, toolName: 'lookup_order', input: JSON.stringify({ order: `LUM-${call}` }) },
                    {
                      type: 'finish' as const,
                      finishReason: { unified: 'tool-calls', raw: 'tool-calls' } as const,
                      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                    },
                  ]
                : [
                    { type: 'text-start' as const, id: '0' },
                    { type: 'text-delta' as const, id: '0', delta: 'All five are on their way.' },
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

    const agent = createAgent({
      index: await index(),
      model,
      actions: [
        {
          name: 'lookup_order',
          whenToUse: 'Look an order up.',
          collect: [{ name: 'order', description: 'the order number', required: true }],
          execute: async () => {
            ran++
            return { status: 'shipped' }
          },
        },
      ],
    })

    await agent.answer('where are my five orders?')

    expect(ran).toBe(5)
  })
})
