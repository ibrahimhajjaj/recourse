import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'

/** A model that answers in one word and records the tools it was handed. */
function watching() {
  const offered: string[][] = []

  const model = new MockLanguageModelV4({
    doStream: async () =>
      ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '1' },
            { type: 'text-delta' as const, id: '1', delta: 'Certainly.' },
            { type: 'text-end' as const, id: '1' },
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
      }) as never,
  })

  const original = model.doStream
  model.doStream = async (options: any) => {
    offered.push((options.tools ?? []).map((tool: any) => tool.name))
    return original.call(model, options)
  }

  return { model, offered }
}

const claim = {
  name: 'warranty_form',
  whenToUse: 'Show the warranty claim form.',
  runs: 'client' as const,
  channels: ['web'],
}

const lookup = { name: 'lookup_order', whenToUse: 'Look up an order.', execute: async () => ({}) }

async function agentWith(model: MockLanguageModelV4) {
  return createAgent({
    index: await buildIndex({
      sources: [textSource([{ id: 'w', title: 'Warranty', text: 'Kettles carry a two year warranty.' }])],
    }),
    model,
    actions: [claim, lookup],
  })
}

describe('an action that only works on one channel', () => {
  it('reaches the model on the channel it names', async () => {
    const { model, offered } = watching()
    const agent = await agentWith(model)

    for await (const frame of agent.stream('warranty claim for my kettle', [], { channel: 'web' })) void frame

    expect(offered[0]).toContain('warranty_form')
  })

  it('is kept off a channel that cannot draw it', async () => {
    // The failure this closes: on WhatsApp the model called a form nothing
    // could render, the turn ended with no text in it, and the customer got
    // silence rather than an answer.
    const { model, offered } = watching()
    const agent = await agentWith(model)

    const result = await agent.answer('warranty claim for my kettle', [], { channel: 'whatsapp' })

    expect(offered[0]).not.toContain('warranty_form')
    expect(offered[0]).toContain('lookup_order')
    expect(result.text).toBe('Certainly.')
  })

  it('is kept off any caller that collects the answer rather than streaming it', async () => {
    // Not about the channel: answer() has no browser on the other end whatever
    // it calls itself, so the round trip a client action needs cannot happen.
    const { model, offered } = watching()
    const agent = await agentWith(model)

    await agent.answer('warranty claim for my kettle', [], { channel: 'web' })

    expect(offered[0]).not.toContain('warranty_form')
  })
})
