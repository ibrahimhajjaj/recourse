import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { defineProcedure, unlockedBy, usableProcedures } from '../src/procedures/index.js'
import { actionsToTools } from '../src/actions/define.js'
import { createAgent } from '../src/agent.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'

const refund = {
  name: 'issue_refund',
  whenToUse: 'Refund an order.',
  procedureOnly: true,
  execute: async () => ({ refunded: true }),
}

const lookup = { name: 'lookup_order', whenToUse: 'Look up an order.', execute: async () => ({}) }

const procedure = defineProcedure({
  name: 'Refund request',
  trigger: 'The customer wants a refund on an order',
  steps: ['Ask for the order number.', 'Call @issue_refund with it.'],
})

const { usable } = usableProcedures([procedure], [refund, lookup])
const bound = (conversation?: string) =>
  Object.keys(actionsToTools([refund, lookup], { unlocked: unlockedBy(usable, conversation), context: { emit: () => {} } }))

describe('an action that only a procedure may reach', () => {
  it('is not bound on a turn that has nothing to do with it', () => {
    // The bug this exists to stop: resolved once at construction, the refund
    // tool was handed to the model on every turn of every conversation, merely
    // left out of the prompt's action list.
    expect(bound('where is my order LUM-1234')).toEqual(['lookup_order'])
  })

  it('is bound once the customer asks for the thing it belongs to', () => {
    expect(bound('I want a refund please')).toContain('issue_refund')
  })

  it('stays bound later in the same flow', () => {
    // Decided from the whole conversation, so step three does not lose the
    // action that step two was told to call.
    const flow = ['I want a refund', 'Sure, what is the order number?', 'LUM-1234'].join('\n')

    expect(bound(flow)).toContain('issue_refund')
  })

  it('matches a plural or a tense the trigger did not use', () => {
    // The trigger says "refund"; people write "refunds" and "refunded".
    expect(bound('how do refunds work')).toContain('issue_refund')
    expect(bound('I was never refunded')).toContain('issue_refund')
  })

  it('leaves an ordinary action alone in every case', () => {
    expect(bound('anything at all')).toContain('lookup_order')
  })

  it('errs open when asked without a conversation', () => {
    // The construction-time question is "does this action exist at all", and
    // answering it closed would hide the action from every turn.
    expect(bound()).toContain('issue_refund')
  })

  it('unlocks a trigger made only of words worth nothing', () => {
    // A trigger with no matchable terms cannot be matched, and locking on that
    // basis would break a working deployment for a wording choice.
    const vague = defineProcedure({ name: 'Vague', trigger: 'the it is a', steps: ['Call @issue_refund.'] })
    const { usable: only } = usableProcedures([vague], [refund])

    expect(unlockedBy(only, 'completely unrelated').has('issue_refund')).toBe(true)
  })
})

/** A model that says one thing and calls nothing, so the turn ends on one step. */
function answering(text: string) {
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

describe('through a whole turn', () => {
  it('hands the model an action a matched procedure unlocked', async () => {
    // The gate above is checked at the tool builder. This one is checked where
    // it matters: the prompt names @issue_refund, so the tool set the model was
    // handed on the same turn has to contain it.
    const model = answering('What is the order number?')
    let offered: string[] = []
    const original = model.doStream
    model.doStream = async (options: any) => {
      offered = (options.tools ?? []).map((tool: any) => tool.name)
      return original.call(model, options)
    }

    const agent = createAgent({
      index: await buildIndex({
        sources: [textSource([{ id: 'r', title: 'Refunds', text: 'We refund within 30 days.' }])],
      }),
      model,
      actions: [refund, lookup],
      procedures: [procedure],
    })
    for await (const frame of agent.stream('I want a refund please')) void frame

    expect(offered).toContain('issue_refund')
    expect(offered).toContain('lookup_order')
  })
})
