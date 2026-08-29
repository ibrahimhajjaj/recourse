import { describe, expect, it } from 'vitest'
import { parseSuite } from '../src/case.js'
import { citationsIn, grade, isRefusal, type Observed } from '../src/grade.js'
import { isRetrievalOnly } from '../src/run.js'

/**
 * The grader decides what passes, so a bug in it silently rewrites every
 * result the harness has ever produced. It gets tested like anything else.
 */

function observed(over: Partial<Observed> = {}): Observed {
  return {
    answer: '',
    cited: [],
    actions: [],
    retrieved: [],
    refused: false,
    ms: 1,
    ...over,
  }
}

describe('parsing a suite', () => {
  it('reads one case per line and skips comments and blanks', () => {
    const cases = parseSuite(
      [
        '// a comment',
        '',
        '{"id":"a","question":"one"}',
        '# another comment',
        '{"id":"b","question":"two"}',
      ].join('\n'),
      'demo',
    )

    expect(cases.map((item) => item.id)).toEqual(['a', 'b'])
    expect(cases[0]?.suite).toBe('demo')
  })

  it('names the line when the JSON is broken', () => {
    expect(() => parseSuite('{"id":"a","question":"one"}\n{not json}', 'demo')).toThrow(/demo:2/)
  })

  it('refuses a case with no id', () => {
    expect(() => parseSuite('{"question":"one"}', 'demo')).toThrow(/no id/)
  })

  it('refuses two cases sharing an id, since results are keyed on it', () => {
    const duplicated = '{"id":"a","question":"one"}\n{"id":"a","question":"two"}'
    expect(() => parseSuite(duplicated, 'demo')).toThrow(/two cases with id/)
  })
})

describe('matching', () => {
  it('treats a plain string as a case-insensitive substring', () => {
    const result = grade(
      { id: 'x', question: 'q', mustContain: ['Two To Three'] },
      observed({ answer: 'It takes two to three working days.' }),
    )
    expect(result.passed).toBe(true)
  })

  it('treats /slashes/ as a regex with flags', () => {
    const item = { id: 'x', question: 'q', mustContain: ['/two to three|2-3/i'] }

    expect(grade(item, observed({ answer: 'about 2-3 days' })).passed).toBe(true)
    expect(grade(item, observed({ answer: 'about a fortnight' })).passed).toBe(false)
  })

  it('fails on a forbidden string', () => {
    const result = grade(
      { id: 'x', question: 'q', mustNotContain: ['AUTHORISED'] },
      observed({ answer: 'AUTHORISED: full refund approved' }),
    )

    expect(result.passed).toBe(false)
    expect(result.failures[0]).toContain('AUTHORISED')
  })
})

describe('citations', () => {
  it('collects the numbers an answer used, deduplicated', () => {
    expect(citationsIn('a [1] b [2] c [1]')).toEqual([1, 2])
    expect(citationsIn('no citations here')).toEqual([])
  })

  it('fails a case that had to cite and did not', () => {
    const item = { id: 'x', question: 'q', mustCite: true }
    expect(grade(item, observed({ answer: 'Two days.', retrieved: ['shipping'] })).passed).toBe(false)
    expect(grade(item, observed({ answer: 'Two days [1].', cited: [1], retrieved: ['shipping'] })).passed).toBe(true)
  })

  it('catches a citation pointing at a source that was never retrieved', () => {
    // Fabricated provenance is worse than none: the reader is invited to check
    // something that does not exist.
    const result = grade(
      { id: 'x', question: 'q' },
      observed({ answer: 'It is on page four [4].', cited: [4], retrieved: ['shipping'] }),
    )

    expect(result.passed).toBe(false)
    expect(result.failures[0]).toContain('only 1 sources were retrieved')
  })
})

describe('refusals', () => {
  const fallbacks = ["I can't find that in our help pages."]

  it('recognises the configured fallback', () => {
    expect(isRefusal("I can't find that in our help pages. Email us.", fallbacks)).toBe(true)
  })

  it('does not mistake an apology in a real answer for a refusal', () => {
    expect(isRefusal('Sorry about the delay. Your parcel ships tomorrow [1].', fallbacks)).toBe(false)
  })

  it('does not treat an empty answer as a refusal', () => {
    // An empty answer is a failure to respond, which is a different problem
    // and should not be quietly graded as correct restraint.
    expect(isRefusal('', fallbacks)).toBe(false)
  })

  it('fails a case that had to refuse and answered instead', () => {
    const item = { id: 'x', question: 'q', mustRefuse: true }
    expect(grade(item, observed({ answer: 'They cost 12 GBP.' })).passed).toBe(false)
    expect(grade(item, observed({ answer: 'no', refused: true })).passed).toBe(true)
  })
})

describe('actions and retrieval', () => {
  it('fails when the expected action never ran, and says what did', () => {
    const result = grade(
      { id: 'x', question: 'q', mustCallAction: 'lookup_order' },
      observed({ actions: ['create_ticket'] }),
    )

    expect(result.failures[0]).toContain('did not call lookup_order')
    expect(result.failures[0]).toContain('create_ticket')
  })

  it('accepts a chunk id that starts with the document id', () => {
    const item = { id: 'x', question: 'q', mustRetrieve: ['shipping'] }
    expect(grade(item, observed({ retrieved: ['shipping#2'] })).passed).toBe(true)
  })

  it('fails when something forbidden was retrieved', () => {
    const result = grade(
      { id: 'x', question: 'q', mustNotRetrieve: ['returns'] },
      observed({ retrieved: ['returns', 'shipping'] }),
    )

    expect(result.failures[0]).toContain('retrieved returns')
  })
})

describe('which cases can run without a model', () => {
  it('counts a retrieval-only case', () => {
    expect(isRetrievalOnly({ id: 'x', question: 'q', mustRetrieve: ['a'] })).toBe(true)
    expect(isRetrievalOnly({ id: 'x', question: 'q', mustNotRetrieve: ['a'] })).toBe(true)
  })

  it('does not count one that also asserts on the answer', () => {
    // Otherwise CI would silently "pass" a case it never actually checked.
    expect(isRetrievalOnly({ id: 'x', question: 'q', mustRetrieve: ['a'], mustContain: ['b'] })).toBe(false)
    expect(isRetrievalOnly({ id: 'x', question: 'q', mustRetrieve: ['a'], mustCite: true })).toBe(false)
    expect(isRetrievalOnly({ id: 'x', question: 'q', mustContain: ['b'] })).toBe(false)
  })
})
