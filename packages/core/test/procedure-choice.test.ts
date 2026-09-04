import { describe, expect, it } from 'vitest'
import { chooseProcedure, matchingProcedures } from '../src/procedures/index.js'
import { resolveContext } from '../src/turn/context.js'
import type { Procedure } from '../src/procedures/types.js'
import type { Action } from '../src/actions/types.js'

const refund: Procedure = {
  name: 'refund_an_order',
  trigger: 'they want their money back for an order',
  steps: ['Ask for the order number.', 'Call @issue_refund with it.'],
}

const shipping: Procedure = {
  name: 'where_is_my_parcel',
  trigger: 'they are asking where their parcel has got to',
  steps: ['Ask for the order number.', 'Call @track_parcel with it.'],
}

/** Everything said, oldest first, the way the turn sees it. */
const said = (...messages: string[]) => messages

function chosen(messages: string[]): string | undefined {
  const matched = matchingProcedures([refund, shipping], messages.join('\n'))
  return chooseProcedure(matched, messages)?.name
}

describe('which procedure a turn runs', () => {
  it('runs the one the customer asked for', () => {
    expect(chosen(said('I want my money back'))).toBe('refund_an_order')
    expect(chosen(said('where has my parcel got to'))).toBe('where_is_my_parcel')
  })

  it('runs one of them and not both', () => {
    // Both triggers are named in one message. Following both interleaves their
    // steps into a reply that reads like two conversations shuffled together,
    // so the one the message shares more words with wins: "money back" is two
    // of the refund trigger's words, "parcel" is one of the shipping one's.
    const both = 'I want my money back, and where has my parcel got to'
    const matched = matchingProcedures([refund, shipping], both)

    expect(matched).toHaveLength(2)
    expect(chooseProcedure(matched, [both])?.name).toBe('refund_an_order')
  })

  it('breaks a real tie on the order they were declared in, rather than wandering', () => {
    const said = ['refund or exchange, whichever is quicker']
    const exchange: Procedure = { ...shipping, name: 'exchange_it', trigger: 'they want an exchange' }
    const money: Procedure = { ...refund, name: 'refund_it', trigger: 'they want a refund' }

    expect(chooseProcedure([money, exchange], said)?.name).toBe('refund_it')
    expect(chooseProcedure([exchange, money], said)?.name).toBe('exchange_it')
  })

  it('stays in the flow when the answer names neither', () => {
    // The whole point of the recency rule. "LUM-1234" is the order number the
    // refund flow asked for, and matches no trigger at all.
    expect(chosen(said('I want my money back', 'What is the order number?', 'LUM-1234'))).toBe('refund_an_order')
  })

  it('switches when the customer changes the subject', () => {
    expect(
      chosen(said('I want my money back', 'What is the order number?', 'actually, where has my parcel got to')),
    ).toBe('where_is_my_parcel')
  })

  it('has nothing to run when nothing matched', () => {
    expect(chooseProcedure([], ['hello'])).toBeUndefined()
  })
})

const form: Action = {
  name: 'warranty_form',
  whenToUse: 'Show the warranty form.',
  runs: 'client',
  channels: ['web'],
}

const notes: Action = { name: 'add_note', whenToUse: 'Note it.', execute: async () => ({}) }

const claim: Procedure = {
  name: 'warranty_claim',
  trigger: 'they want to claim on the warranty',
  steps: [
    'Ask which product it is.',
    {
      branches: [{ if: 'it is still in warranty', then: 'Show them @warranty_form.' }],
      otherwise: 'Call @add_note saying it had expired.',
    },
  ],
}

const quiet = { warn: () => {}, error: () => {} }

function context(channel: string) {
  return resolveContext({
    messages: [{ role: 'user', content: 'I want to claim on the warranty for my kettle' }],
    found: [],
    procedures: [claim],
    actions: [form, notes],
    passageThreshold: null,
    channel,
    logger: quiet,
  })
}

describe('what the agent says about itself', () => {
  const issue: Action = { name: 'issue_refund', whenToUse: 'Refund it.', execute: async () => ({}) }
  const track: Action = { name: 'track_parcel', whenToUse: 'Track it.', execute: async () => ({}) }

  function turn(messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
    return resolveContext({
      messages,
      found: [],
      procedures: [refund, shipping],
      actions: [issue, track],
      passageThreshold: null,
      logger: quiet,
    })
  }

  it('cannot switch the flow with a helpful aside', () => {
    // The agent offering to look at a parcel is not the customer asking about
    // one, and a flow that can be steered by its own reply is not a flow.
    const running = turn([
      { role: 'user', content: 'I want my money back' },
      { role: 'assistant', content: 'Of course. I can also tell you where your parcel has got to.' },
      { role: 'user', content: 'LUM-1234' },
    ])

    expect(running.applicable.map((p) => p.name)).toEqual(['refund_an_order'])
  })

  it('still switches when the customer does', () => {
    const running = turn([
      { role: 'user', content: 'I want my money back' },
      { role: 'assistant', content: 'What is the order number?' },
      { role: 'user', content: 'actually, where has my parcel got to' },
    ])

    expect(running.applicable.map((p) => p.name)).toEqual(['where_is_my_parcel'])
  })
})

describe('a turn where two procedures both match', () => {
  const issue: Action = { name: 'issue_refund', whenToUse: 'Refund it.', execute: async () => ({}) }
  const track: Action = { name: 'track_parcel', whenToUse: 'Track it.', execute: async () => ({}) }

  const turn = resolveContext({
    messages: [{ role: 'user', content: 'I want my money back, and where has my parcel got to' }],
    found: [],
    procedures: [refund, shipping],
    actions: [issue, track],
    passageThreshold: null,
    logger: quiet,
  })

  it('carries exactly one of them into the prompt', () => {
    expect(turn.applicable.map((p) => p.name)).toEqual(['refund_an_order'])
  })

  it('unlocks only that one’s actions', () => {
    // The prompt and the tool set are built from the same answer, so a second
    // procedure left out of the prompt must not leave its tools bound.
    expect([...turn.unlocked]).toEqual(['issue_refund'])
  })
})

describe('a procedure whose actions this channel cannot run', () => {
  it('runs where every action it names is available', () => {
    expect(context('web').applicable.map((p) => p.name)).toEqual(['warranty_claim'])
  })

  it('is dropped whole rather than started and stranded', () => {
    // The reference is inside a branch this conversation might never take, and
    // it still counts: whether it gets there is not knowable until the flow has
    // already begun, and a flow that stops four steps in is worse than none.
    expect(context('whatsapp').applicable).toEqual([])
    expect(context('whatsapp').unlocked.size).toBe(0)
  })
})
