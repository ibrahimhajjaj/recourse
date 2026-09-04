import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { memoryStore } from '../src/store/index.js'
import { suggestedMessages } from '../src/actions/index.js'
import type { Action } from '../src/actions/types.js'
import type { StreamFrame } from '../src/types.js'

/**
 * A model that streams one answer, then answers the follow-up call.
 *
 * Two calls arrive on the same model: the turn itself through doStream, and
 * the follow-up proposal through doGenerate. Keeping them apart is what makes
 * the second one visible at all.
 */
function model(followUps = 'How long does delivery take?|Do you ship to Ireland?') {
  const generated: string[] = []

  const instance = new MockLanguageModelV4({
    doStream: async () =>
      ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: '1' },
            { type: 'text-delta' as const, id: '1', delta: 'We refund within 30 days.' },
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
    doGenerate: async (options: any) => {
      generated.push(String(options.prompt?.at(-1)?.content?.[0]?.text ?? ''))
      return {
        content: [{ type: 'text', text: followUps }],
        finishReason: 'stop',
        usage: {
          inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      } as never
    },
  })

  return { instance, generated }
}

async function agentWith(instance: MockLanguageModelV4, extra: Record<string, unknown> = {}) {
  return createAgent({
    index: await buildIndex({
      sources: [textSource([{ id: 'r', title: 'Refunds', text: 'We refund within 30 days.' }])],
    }),
    model: instance,
    ...extra,
  })
}

async function frames(agent: { stream: (q: string) => AsyncGenerator<StreamFrame> }, question: string) {
  const seen: StreamFrame[] = []
  for await (const frame of agent.stream(question)) seen.push(frame)
  return seen
}

describe('follow-up questions after every reply', () => {
  it('offers them without the model having to ask', async () => {
    const { instance, generated } = model()
    const seen = await frames(await agentWith(instance, { followUps: true }), 'do you do refunds?')

    expect(seen.find((frame) => frame.type === 'suggestions')).toMatchObject({
      items: ['How long does delivery take?', 'Do you ship to Ireland?'],
    })
    // Asked from the exchange, so the proposals are about what was just said.
    expect(generated[0]).toContain('We refund within 30 days.')
  })

  it('offers none when it is switched off, and makes no second call', async () => {
    const { instance, generated } = model()
    const seen = await frames(await agentWith(instance), 'do you do refunds?')

    expect(seen.some((frame) => frame.type === 'suggestions')).toBe(false)
    expect(generated).toEqual([])
  })

  it('keeps them behind the answer', async () => {
    // The customer reads the reply while this runs. Emitting the buttons first
    // would mean waiting on them before a single word arrived.
    const { instance } = model()
    const seen = await frames(await agentWith(instance, { followUps: true }), 'do you do refunds?')

    const answer = seen.findIndex((frame) => frame.type === 'delta')
    const offered = seen.findIndex((frame) => frame.type === 'suggestions')
    const done = seen.findIndex((frame) => frame.type === 'done')

    expect(answer).toBeLessThan(offered)
    expect(offered).toBeLessThan(done)
  })

  it('respects the limit it was given', async () => {
    const { instance } = model('One?|Two?|Three?|Four?')
    const seen = await frames(await agentWith(instance, { followUps: { max: 2 } }), 'do you do refunds?')

    expect((seen.find((frame) => frame.type === 'suggestions') as { items: string[] }).items).toEqual(['One?', 'Two?'])
  })

  it('offers none when the agent just failed to answer', async () => {
    // Retrieval found nothing, so a row of buttons proposing more questions is
    // the widget being cheerful about a gap, and every one of them is a
    // question it is about to fail in the same way.
    const { instance, generated } = model()
    const agent = createAgent({
      index: await buildIndex({ sources: [textSource([{ id: 'r', title: 'Hours', text: 'We open at nine.' }])] }),
      model: instance,
      followUps: true,
    })

    const seen = await frames(agent, 'zzzz quantum flux capacitor')

    expect(seen.some((frame) => frame.type === 'suggestions')).toBe(false)
    expect(generated).toEqual([])
  })

  it('says nothing when the model proposes nothing', async () => {
    const { instance } = model('   ')
    const seen = await frames(await agentWith(instance, { followUps: true }), 'do you do refunds?')

    expect(seen.some((frame) => frame.type === 'suggestions')).toBe(false)
  })

  it('does not buy them once the cap has been crossed', async () => {
    // The cap was read before the answer and the answer has since been paid
    // for. Without a second look, a deployment that crossed the line during
    // its own turn buys a row of buttons on the wrong side of its limit.
    let spent = 0
    const budget = {
      check: async () => (spent > 0 ? { ok: false as const, reason: 'capped' } : { ok: true as const }),
      spent: async () => ({ day: { tokens: 0, dollars: 0 }, month: { tokens: 0, dollars: 0 } }),
      record: async () => void spent++,
    }

    const { instance, generated } = model()
    const seen = await frames(await agentWith(instance, { followUps: true, budget }), 'do you do refunds?')

    expect(seen.some((frame) => frame.type === 'delta')).toBe(true)
    expect(seen.some((frame) => frame.type === 'suggestions')).toBe(false)
    expect(generated).toEqual([])
    // The turn still owes a `done`, or a client waits for an answer it has.
    expect(seen[seen.length - 1]).toMatchObject({ type: 'done' })
  })

  it('does not read a shared cap on a turn that was never going to ask', async () => {
    // `check()` is a network round trip on a shared limiter, and doubling it
    // on every reply is a real cost for deployments that never turned this on.
    let checks = 0
    const budget = {
      check: async () => {
        checks++
        return { ok: true as const }
      },
      spent: async () => ({ day: { tokens: 0, dollars: 0 }, month: { tokens: 0, dollars: 0 } }),
      record: async () => {},
    }

    const { instance } = model()
    await frames(await agentWith(instance, { budget }), 'do you do refunds?')

    expect(checks).toBe(1)
  })

  it('bills the extra call, since it happens on every reply', async () => {
    const recorded: Array<{ model: string; usage: unknown }> = []
    const budget = {
      check: async () => ({ ok: true as const }),
      spent: async () => ({ day: { tokens: 0, dollars: 0 }, month: { tokens: 0, dollars: 0 } }),
      record: async (name: string, usage: unknown) => void recorded.push({ model: name, usage }),
    }

    const { instance } = model()
    await frames(await agentWith(instance, { followUps: true, budget }), 'do you do refunds?')

    // Two calls, two entries: the turn itself and the proposal after it.
    expect(recorded).toHaveLength(2)
    expect(recorded[1]?.usage).toMatchObject({ inputTokens: 20, outputTokens: 10 })
  })

  it('survives a proposal call that fails', async () => {
    const instance = new MockLanguageModelV4({
      doStream: async () =>
        ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: '1' },
              { type: 'text-delta' as const, id: '1', delta: 'We refund within 30 days.' },
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
      doGenerate: async () => {
        throw new Error('the provider fell over')
      },
    })

    const seen = await frames(await agentWith(instance, { followUps: true }), 'do you do refunds?')

    // The answer already reached the customer. A missing row of buttons is not
    // worth turning that into an error.
    expect(seen.some((frame) => frame.type === 'error')).toBe(false)
    expect(seen.some((frame) => frame.type === 'done')).toBe(true)
  })
})

/** A model that calls one tool, then answers. */
function callsThen(toolName: string, input: Record<string, unknown>) {
  let step = 0
  const generated: string[] = []

  const instance = new MockLanguageModelV4({
    doStream: async () => {
      step++
      return step === 1
        ? ({
            stream: simulateReadableStream({
              chunks: [
                { type: 'tool-call' as const, toolCallId: 'call-1', toolName, input: JSON.stringify(input) },
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
          } as never)
        : ({
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start' as const, id: '1' },
                { type: 'text-delta' as const, id: '1', delta: 'Done.' },
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
          } as never)
    },
    doGenerate: async () => {
      generated.push('asked')
      return {
        content: [{ type: 'text', text: 'Anything else?' }],
        finishReason: 'stop',
        usage: {
          inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      } as never
    },
  })

  return { instance, generated }
}

describe('when the follow-ups are somebody else’s job', () => {
  it('leaves the model’s own suggestions alone rather than asking twice', async () => {
    const { instance, generated } = callsThen('suggest_replies', { suggestions: 'Where is my order?|Do you ship abroad?' })
    const agent = await agentWith(instance, { followUps: true, actions: [suggestedMessages()] })
    const seen = await frames(agent, 'do you do refunds?')

    const offered = seen.filter((frame) => frame.type === 'suggestions')
    expect(offered).toHaveLength(1)
    expect(offered[0]).toMatchObject({ items: ['Where is my order?', 'Do you ship abroad?'] })
    expect(generated).toEqual([])
  })

  it('offers nothing once a person has the conversation', async () => {
    // Proposing what to ask next, under a message saying somebody will be in
    // touch, is the widget talking over the handover.
    const escalate: Action = {
      name: 'get_a_person',
      whenToUse: 'Hand over.',
      async execute(_input, ctx) {
        ctx.emit({ type: 'handoff', message: 'Someone will be with you shortly.' })
        return { handedOver: true }
      },
    }

    const { instance, generated } = callsThen('get_a_person', {})
    const seen = await frames(await agentWith(instance, { followUps: true, actions: [escalate] }), 'I want a person')

    expect(seen.some((frame) => frame.type === 'handoff')).toBe(true)
    expect(seen.some((frame) => frame.type === 'suggestions')).toBe(false)
    expect(generated).toEqual([])
  })
})

describe('a second attempt at a question', () => {
  it('does not write the question down twice', async () => {
    // The caller has dropped the answer it did not want and sent the history
    // ending at the question. Recording it again would leave a transcript
    // where the customer appears to have asked the same thing twice.
    const { instance } = model()
    const store = memoryStore()
    const agent = await agentWith(instance, { store })

    for await (const frame of agent.stream('do you do refunds?', [], { conversationId: 'c1' })) void frame
    for await (const frame of agent.stream('do you do refunds?', [], { conversationId: 'c1', retry: true })) void frame

    const thread = await store.getConversation('c1')
    const asked = (thread?.messages ?? []).filter((message) => message.role === 'user')

    expect(asked).toHaveLength(1)
    // Both answers stay. The one nobody wanted is a documented case of this
    // agent answering badly, which is the useful half of the record.
    expect((thread?.messages ?? []).filter((message) => message.role === 'assistant')).toHaveLength(2)
  })
})
