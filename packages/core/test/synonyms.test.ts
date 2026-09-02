import { describe, expect, it } from 'vitest'
import { expandQuery } from '../src/retrieve/synonyms.js'
import { buildIndex } from '../src/knowledge/build.js'
import { textSource } from '../src/sources/text.js'
import { createRetriever } from '../src/retrieve/retriever.js'

describe('the words a customer uses against the words a page uses', () => {
  it('keeps what was asked and adds to it', () => {
    // Never a substitution. The customer's own words are usually right, and a
    // page using them should still be the one that wins.
    const expanded = expandQuery('how do I get my money back?')

    expect(expanded).toContain('money back')
    expect(expanded).toContain('refund')
  })

  it('leaves a question with nothing to add alone', () => {
    expect(expandQuery('what are your opening hours?')).toBe('what are your opening hours?')
  })

  it('matches whole words only', () => {
    // "bill" inside "billing address" is not the noun. Adding invoice and
    // receipt there pulls the accounts page into a question about an address.
    expect(expandQuery('update my billing address')).toBe('update my billing address')
    expect(expandQuery('where is my bill?')).toContain('invoice')
  })

  it('takes a business own vocabulary', () => {
    const expanded = expandQuery('do you have trainers in a 9?', [['trainers', 'sneakers']])

    expect(expanded).toContain('sneakers')
  })

  it('can be turned off for content where those words mean something else', () => {
    expect(expandQuery('how do I get my money back?', false)).toBe('how do I get my money back?')
  })
})

describe('what that does to retrieval with no embedder at all', () => {
  const corpus = [
    { id: 'returns', title: 'Returns', text: 'We refund any order within 30 days of delivery. Return postage is free.' },
    { id: 'shipping', title: 'Shipping', text: 'Delivery takes two to three working days and costs four pounds.' },
    { id: 'hours', title: 'Opening hours', text: 'We are open nine to five, Monday to Friday.' },
  ]

  const find = async (question: string, synonyms?: false) => {
    const index = await buildIndex({ sources: [textSource(corpus)] })
    const retriever = createRetriever({ index, ...(synonyms === false ? { synonyms: false } : {}) })

    return (await retriever.retrieve(question)).map((match) => match.chunk.docId)
  }

  it('finds the refund policy from words the policy never uses', async () => {
    // Without this the page is in the index, matches nothing, and the agent
    // tells the customer it cannot find a policy that is sitting right there.
    expect(await find('how do I get my money back?', false)).not.toContain('returns')
    expect(await find('how do I get my money back?')).toContain('returns')
  })

  it('prefers the page about the thing over the page that happens to use the word', async () => {
    // "postage" appears on the returns page and nowhere on the shipping page,
    // so the honest keyword answer is the wrong one.
    const found = await find('how much is postage?')

    expect(found[0]).toBe('shipping')
  })

  it('does not drag an unrelated page into a question it has nothing to do with', async () => {
    expect(await find('what are your opening hours?')).not.toContain('returns')
  })
})
