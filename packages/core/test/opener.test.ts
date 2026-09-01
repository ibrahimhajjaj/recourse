import { describe, expect, it } from 'vitest'
import { createOpenerFilter } from '../src/server/opener.js'

/** Streams the text in chunks, the way a model actually produces it. */
function streamed(text: string, chunk = 4): string {
  const filter = createOpenerFilter()
  let out = ''
  for (let at = 0; at < text.length; at += chunk) out += filter.push(text.slice(at, at + chunk))

  return out + filter.flush()
}

describe('cutting the throat-clearing off an answer', () => {
  it('removes the pleasantry and keeps the answer', () => {
    // The instructions already ask for this and a small model ignores them,
    // which is the whole reason this exists rather than one more prompt line.
    expect(streamed('Certainly! Delivery takes four days.')).toBe('Delivery takes four days.')
    expect(streamed("I'd be happy to help. Your order shipped.")).toBe('Your order shipped.')
    expect(streamed('Great question! We refund within 30 days.')).toBe('We refund within 30 days.')
    expect(streamed('As an AI, I cannot access that.')).toBe('I cannot access that.')
  })

  it('removes them when they stack', () => {
    expect(streamed('Certainly! Happy to help. Your order shipped.')).toBe('Your order shipped.')
  })

  it('leaves a real answer completely alone', () => {
    for (const answer of [
      'Delivery takes four to seven working days.',
      'Your order shipped on Tuesday.',
      'I cannot find that in our help pages.',
      'Surely you meant the other order?',
      'Sure enough, it shipped yesterday.',
    ]) {
      expect(streamed(answer), answer).toBe(answer)
    }
  })

  it('keeps a pleasantry that is the whole reply', () => {
    // A greeting. "Of course" on its own is the correct answer to "can you
    // help me?", and an empty reply is worse than a polite one.
    expect(streamed('Of course!')).toBe('Of course!')
    expect(streamed('Sure')).toBe('Sure')
  })

  it('does not clip a word that merely starts like one', () => {
    expect(streamed('Absolutely everything is covered.')).toBe('Absolutely everything is covered.')
  })

  it('costs nothing on an answer that starts with the answer', () => {
    // The point of holding text only while it could still be a pleasantry: a
    // good reply is released on its first chunk, so this buys the filter at no
    // cost to how fast the first word appears.
    const filter = createOpenerFilter()

    expect(filter.push('Delivery ')).toBe('Delivery ')
  })

  it('holds only while what arrived could still become one', () => {
    const filter = createOpenerFilter()

    // "Cert" could still be "Certainly", so it waits.
    expect(filter.push('Cert')).toBe('')
    expect(filter.push('ainly! Ships today.')).toBe('Ships today.')
  })

  it('stops filtering once it has decided', () => {
    // Otherwise it goes looking in the middle of an answer, and a filter that
    // eats real words is worse than the tic it removes.
    const filter = createOpenerFilter()
    filter.push('Your order shipped. ')

    expect(filter.push('Certainly worth tracking.')).toBe('Certainly worth tracking.')
  })

  it('gives back what it was holding when the stream ends early', () => {
    const filter = createOpenerFilter()
    filter.push('Cert')

    expect(filter.flush()).toBe('Cert')
  })

  it('survives an empty stream', () => {
    const filter = createOpenerFilter()

    expect(filter.flush()).toBe('')
  })
})
