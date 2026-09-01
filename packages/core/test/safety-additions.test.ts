import { describe, expect, it } from 'vitest'
import { INPUT_RULES, OUTPUT_RULES } from '../src/safety/rules.js'

const run = (rules: typeof INPUT_RULES, name: string, text: string, context?: unknown) => {
  const rule = rules.find((candidate) => candidate.name === name)
  if (!rule) throw new Error(`no rule named ${name}`)

  return rule.run(text, undefined as never, context as never)
}

describe('a link the agent made up', () => {
  const sources = ['Refunds: read more at https://lumen.example/help/returns']

  it('flags one that appears in no source', () => {
    // Every site has a /help/refunds, so the model has seen a thousand of them
    // and writes one confidently.
    const out = run(OUTPUT_RULES, 'ungrounded-contacts', 'See https://lumen.example/help/refund-policy', { sources })

    expect(out.signals[0]?.category).toBe('ungrounded-contact')
    expect(out.signals[0]?.reason).toContain('a link')
  })

  it('allows one that is in a source', () => {
    expect(run(OUTPUT_RULES, 'ungrounded-contacts', 'See https://lumen.example/help/returns', { sources }).signals).toEqual([])
  })

  it('ignores a tracking parameter when comparing', () => {
    const out = run(OUTPUT_RULES, 'ungrounded-contacts', 'See https://lumen.example/help/returns?utm=chat', { sources })

    expect(out.signals).toEqual([])
  })

  it('still checks when retrieval found nothing', () => {
    // The bug: this returned early on empty sources, which is exactly the turn
    // where the model has nothing to answer from and invents something useful.
    const out = run(OUTPUT_RULES, 'ungrounded-contacts', 'Call us on +44 20 7946 0958', { sources: [] })

    expect(out.signals[0]?.category).toBe('ungrounded-contact')
  })
})

describe('the model refusing instead of answering', () => {
  it('routes a refusal to a person', () => {
    for (const refusal of [
      "I'm sorry, but I cannot help with that.",
      'Unfortunately, I am unable to assist with this request.',
      'As an AI language model, I do not have access to that.',
      "I can't help with that, sorry.",
    ]) {
      expect(run(OUTPUT_RULES, 'model-refusal', refusal).signals[0]?.category, refusal).toBe('refusal')
    }
  })

  it('leaves an answer that merely mentions being sorry', () => {
    // Apologising for a late parcel is an answer, not a refusal.
    for (const answer of [
      "I'm sorry your parcel is late. It shipped on Tuesday and should arrive Friday.",
      'We cannot refund wholesale orders over 5kg, but I can offer a replacement.',
      'Sorry about that. Your refund lands in three to five working days.',
    ]) {
      expect(run(OUTPUT_RULES, 'model-refusal', answer).signals, answer).toEqual([])
    }
  })
})

describe('numbers a customer should not have sent', () => {
  it('takes a card number out before it goes anywhere', () => {
    const out = run(INPUT_RULES, 'payment-details', 'my card 4111 1111 1111 1111 was charged twice')

    expect(out.text).toBe('my card [card ending 1111] was charged twice')
    expect(out.signals[0]?.category).toBe('pii')
  })

  it('leaves an order number of the same length alone', () => {
    // Sixteen digits with no valid checksum is an order number, and redacting
    // those would break the product it is meant to protect.
    const order = 'my order 1234567812345678 has not arrived'

    expect(run(INPUT_RULES, 'payment-details', order).text).toBe(order)
  })

  it('leaves ordinary numbers alone', () => {
    for (const message of ['I ordered 2 bags on 12 August', 'ref LUM-1234', 'it cost 39.95']) {
      expect(run(INPUT_RULES, 'payment-details', message).text, message).toBe(message)
    }
  })

  it('removes a national insurance number and an account number', () => {
    expect(run(INPUT_RULES, 'payment-details', 'ssn 123-45-6789').text).toBe('ssn [removed]')
    expect(run(INPUT_RULES, 'payment-details', 'iban GB82WEST12345698765432 please').text).toContain('[removed]')
  })

  it('does not refuse the turn', () => {
    // The question is still answerable; refusing would teach the customer to
    // send the number again in another shape.
    const out = run(INPUT_RULES, 'payment-details', 'card 4111111111111111 charged twice')

    expect(out.text).toContain('charged twice')
  })
})
