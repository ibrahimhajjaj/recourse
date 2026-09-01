import { describe, expect, it } from 'vitest'
import { mentions } from '../src/relevance.js'
import { offeredActions } from '../src/actions/define.js'
import type { Action } from '../src/actions/types.js'

const action = (extra: Partial<Action>): Action => ({
  name: 'act',
  whenToUse: 'do a thing',
  runs: 'server',
  collect: [],
  execute: async () => ({}),
  ...extra,
})

describe('mentions', () => {
  it('matches on a shared distinctive word', () => {
    expect(mentions('stock availability in store', 'do you have it in stock?')).toBe(true)
  })

  it('does not match a conversation about something else', () => {
    expect(mentions('stock availability in store', 'where is my parcel?')).toBe(false)
  })

  it('ignores the words every support conversation contains', () => {
    // "my order" appears in a shipping question and a refund question alike, so
    // matching on it alone would offer everything to everyone. A phrase with
    // nothing else in it is not a filter, and matches everything rather than
    // pretending to be one.
    expect(mentions('order', 'my order has not arrived')).toBe(true)
    expect(mentions('order', 'what are your opening hours')).toBe(true)
    expect(mentions('refund an order', 'what are your opening hours')).toBe(false)
  })

  it('works in a language without spaces between words', () => {
    expect(mentions('退款', '我想申请退款')).toBe(true)
    expect(mentions('退款', '你们几点开门')).toBe(false)
  })

  it('works in Arabic, where the same word is written several ways', () => {
    expect(mentions('استرداد', 'اريد الأسترداد')).toBe(true)
  })
})

describe('offeredActions', () => {
  it('offers an unrelated action when nothing gates it', () => {
    const actions = [action({ name: 'a' })]
    expect(offeredActions(actions, { conversation: 'hello' }).map((a) => a.name)).toEqual(['a'])
  })

  it('holds back an action the conversation is not about', () => {
    const actions = [action({ name: 'stock', relevantWhen: 'stock availability' })]
    expect(offeredActions(actions, { conversation: 'where is my parcel' })).toEqual([])
  })

  it('offers it once the conversation turns to it', () => {
    const actions = [action({ name: 'stock', relevantWhen: 'stock availability' })]
    expect(offeredActions(actions, { conversation: 'is it in stock' }).map((a) => a.name)).toEqual(['stock'])
  })

  it('offers everything when there is no conversation to judge', () => {
    const actions = [action({ name: 'stock', relevantWhen: 'stock availability' })]
    expect(offeredActions(actions, {}).map((a) => a.name)).toEqual(['stock'])
  })

  it('keeps an unlocked action even when the words have moved on', () => {
    // Halfway through a procedure the customer answers "yes". Dropping the tool
    // at that point strands the flow.
    const actions = [action({ name: 'refund', relevantWhen: 'refund money back', procedureOnly: true })]
    const offered = offeredActions(actions, { conversation: 'yes', unlocked: new Set(['refund']) })
    expect(offered.map((a) => a.name)).toEqual(['refund'])
  })

  it('still hides a procedure-only action nothing unlocked', () => {
    const actions = [action({ name: 'refund', procedureOnly: true })]
    expect(offeredActions(actions, { conversation: 'refund please' })).toEqual([])
  })
})

describe('what the retriever found is part of what the turn is about', () => {
  it('offers a stock action for a question that never says "stock"', async () => {
    const { buildIndex } = await import('../src/knowledge/build.js')
    const { createRetriever } = await import('../src/retrieve/retriever.js')
    const { textSource } = await import('../src/sources/text.js')

    const index = await buildIndex({
      sources: [
        textSource([
          {
            id: 'sizing',
            title: 'Sizes and stock',
            text: 'We stock small, medium and large. Availability is shown on each product page.',
          },
          { id: 'hours', title: 'Opening hours', text: 'We open at nine and close at five, Monday to Friday.' },
        ]),
      ],
    })

    const stock = action({ name: 'check_stock', relevantWhen: 'stock availability sizes in store' })
    const asked = 'do you have this in a medium?'

    // The words alone miss it: nothing in the question is in the phrase.
    expect(offeredActions([stock], { conversation: asked })).toEqual([])

    const matches = await createRetriever({ index }).retrieve(asked)
    const withPassages = `${asked}\n${matches.map((match) => match.chunk.text).join('\n')}`

    expect(offeredActions([stock], { conversation: withPassages }).map((a) => a.name)).toEqual(['check_stock'])
  })
})
