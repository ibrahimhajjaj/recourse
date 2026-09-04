import { describe, expect, it } from 'vitest'
import { matchingProcedures, renderProcedures, unlockedBy } from '../src/procedures/index.js'
import type { Procedure } from '../src/procedures/types.js'

const refund: Procedure = {
  name: 'refund_an_order',
  trigger: 'they want their money back for an order',
  steps: ['Ask for the order number.', 'Call @issue_refund with it.'],
}

const shipping: Procedure = {
  name: 'where_is_my_order',
  trigger: 'they are asking where their parcel has got to',
  steps: ['Ask for the order number.', 'Call @track_parcel with it.'],
}

describe('which procedures reach the prompt', () => {
  it('describes none of them on a turn about nothing', () => {
    const on = matchingProcedures([refund, shipping], 'hi')

    expect(on).toEqual([])
    expect(renderProcedures(on, {})).toBe('')
  })

  it('describes only the one being talked about', () => {
    const on = matchingProcedures([refund, shipping], 'I want my money back')

    expect(on.map((procedure) => procedure.name)).toEqual(['refund_an_order'])
    expect(renderProcedures(on, {})).not.toContain('track_parcel')
  })

  it('never names an action it has not also unlocked', () => {
    // The failure this guards against is silent and specific: the prompt told
    // the model to call @issue_refund on every turn while the tool was bound
    // only on matching ones, so it reached for something it had not been given.
    for (const said of ['hi', 'I want my money back', 'where is my parcel', 'thanks, bye']) {
      const on = matchingProcedures([refund, shipping], said)
      const bound = unlockedBy(on)
      const prompt = renderProcedures(on, {})

      for (const action of ['issue_refund', 'track_parcel']) {
        expect(prompt.includes(`@${action}`), `${said}: prompt names @${action}`).toBe(bound.has(action))
      }
    }
  })

  it('keeps describing a procedure once it is under way', () => {
    // The customer answers "LUM-1234" three turns in. The trigger words are
    // long gone from the last message, which is why the whole conversation is
    // what gets matched rather than the newest line.
    const conversation = ['I want my money back', 'ok', 'LUM-1234'].join('\n')

    expect(matchingProcedures([refund, shipping], conversation).map((p) => p.name)).toEqual([
      'refund_an_order',
    ])
  })

  it('describes everything when there is no conversation to judge', () => {
    expect(matchingProcedures([refund, shipping]).length).toBe(2)
  })
})

describe('what the agent actually puts in the prompt', () => {
  it('leaves an unrelated procedure out of the instructions entirely', async () => {
    const { createAgent } = await import('../src/agent.js')
    const { buildIndex } = await import('../src/knowledge/build.js')
    const { textSource } = await import('../src/sources/text.js')
    const { MockLanguageModelV4 } = await import('ai/test')
    const { simulateReadableStream } = await import('ai')

    let instructions = ''

    const model = new MockLanguageModelV4({
      doStream: async (options: any) => {
        instructions = String(options.prompt.find((entry: any) => entry.role === 'system')?.content ?? '')
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: '0' },
              { type: 'text-delta' as const, id: '0', delta: 'Hello.' },
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
        }
      },
    })

    const index = await buildIndex({
      sources: [textSource([{ id: 'faq', title: 'FAQ', text: 'We are open nine to five, Monday to Friday.' }])],
    })

    const agent = createAgent({
      index,
      model,
      procedures: [refund, shipping],
      actions: [
        { name: 'issue_refund', whenToUse: 'Refund an order.', procedureOnly: true, execute: async () => ({}) },
        { name: 'track_parcel', whenToUse: 'Track a parcel.', procedureOnly: true, execute: async () => ({}) },
      ],
    })

    await agent.answer('hi')

    // Roughly nine hundred tokens of procedure on a message that is one word,
    // and worse, each naming an action the model has not been given.
    expect(instructions).not.toContain('refund_an_order')
    expect(instructions).not.toContain('where_is_my_order')

    await agent.answer('I want my money back')

    expect(instructions).toContain('refund_an_order')
    expect(instructions).not.toContain('where_is_my_order')
  })
})

describe('a procedure limited to certain channels', () => {
  const upload: Procedure = {
    name: 'warranty_claim',
    trigger: 'they want to claim on the warranty',
    steps: ['Show them @warranty_form.', 'Call @open_claim with what it returns.'],
    channels: ['web'],
  }

  const said = 'I want to claim on the warranty for my kettle'

  it('runs where it was allowed and nowhere else', () => {
    expect(matchingProcedures([upload], said, 'web').map((p) => p.name)).toEqual(['warranty_claim'])
    expect(matchingProcedures([upload], said, 'whatsapp')).toEqual([])
  })

  it('still has to match the conversation on a channel it allows', () => {
    expect(matchingProcedures([upload], 'where is my parcel', 'web')).toEqual([])
  })

  it('is unaffected when the caller did not say where it is', () => {
    expect(matchingProcedures([upload], said).map((p) => p.name)).toEqual(['warranty_claim'])
  })

  it('leaves a procedure with no channels alone', () => {
    expect(matchingProcedures([refund], 'I want my money back', 'sms').map((p) => p.name)).toEqual(['refund_an_order'])
  })
})
