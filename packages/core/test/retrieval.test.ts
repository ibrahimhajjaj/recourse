import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/knowledge/tokenize.js'
import { buildKeywordIndex, searchKeyword } from '../src/knowledge/bm25.js'
import { buildVectorIndex, normalize, searchVector } from '../src/knowledge/vector.js'
import { fuse } from '../src/retrieve/fuse.js'

describe('tokenize', () => {
  it('drops stopwords and folds inflections together', () => {
    expect(tokenize('How do I cancel my subscription?')).toEqual(['cancel', 'subscription'])
    expect(tokenize('shipping')).toEqual(tokenize('shipped'))
    expect(tokenize('policies')).toEqual(tokenize('policy'))
  })

  it('keeps non-latin scripts instead of discarding them', () => {
    // The hamza is normalised away and the article comes off, both for the
    // same reason: most people do not type either consistently, and the
    // spellings have to meet somewhere.
    expect(tokenize('كيف يمكنني الإلغاء')).toEqual(['كيف', 'يمكنني', 'الغاء'])
  })

  it('finds one Arabic word however it was spelled', () => {
    // All four of these are the same word to a reader and were four separate
    // terms to the index, so a customer typing the ordinary spelling matched
    // nothing on a page that used the careful one.
    const plain = tokenize('التوصيل')
    expect(tokenize('التَّوْصِيل')).toEqual(plain)

    expect(tokenize('أحمد')).toEqual(tokenize('احمد'))
    expect(tokenize('مدرسة')).toEqual(tokenize('مدرسه'))
    expect(tokenize('على')).toEqual(tokenize('علي'))
  })

  it('splits a script that writes no spaces', () => {
    // Japanese and Chinese put nothing between words, so the old rule returned
    // the whole sentence as one term and it matched only itself: a shop with
    // Japanese pages retrieved nothing, silently.
    expect(tokenize('配送时间需要多久')).toEqual(['配送', '送时', '时间', '间需', '需要', '要多', '多久'])

    // And a real question overlaps a real page.
    const page = tokenize('配送时间通常需要三天')
    expect(tokenize('配送需要多久').some((term) => page.includes(term))).toBe(true)
  })

  it('leaves Korean alone, because it is written with spaces', () => {
    expect(tokenize('배송은 얼마나 걸리나요')).toEqual(['배송은', '얼마나', '걸리나요'])
  })

  it('reads a sentence that mixes a script with a product code', () => {
    expect(tokenize('LUM-1234の配送')).toEqual(['lum', '1234', 'の配', '配送'])
  })

  it('spells an accent one way whichever way it arrived', () => {
    // The same word from two editors: one composes the accent, one does not.
    expect(tokenize('caf\u00e9')).toEqual(tokenize('cafe\u0301'))
  })

  it('ignores punctuation and single characters', () => {
    expect(tokenize('a b -- ??? refund!!')).toEqual(['refund'])
  })

  it('reads a word with the Arabic article as the same word without it', () => {
    // The article is written joined to the noun, so a page saying "shipping"
    // and a customer asking about "the shipping" share no term without this.
    expect(tokenize('الشحن')).toEqual(tokenize('شحن'))
    expect(tokenize('بالبريد')).toEqual(tokenize('بريد'))
  })

  it('leaves a short word alone rather than stripping it to nothing', () => {
    // Two letters left over is the wrong reading of a short word, not a stem.
    expect(tokenize('الله')).toEqual(['الله'])
  })

  it('does not treat a leading waw as a prefix', () => {
    // "and" is spelled with the same letter that starts ordinary words.
    expect(tokenize('ولد')).toEqual(['ولد'])
  })

})

describe('ranking a corpus with no spaces in it', () => {
  // The shape of the original failure: three real pages, three real questions,
  // and nothing matched. Every question returned the whole sentence as one
  // term, which appears in no document but itself.
  const pages = [
    '配送時間は国によって異なります。日本国内は通常一から二営業日です。',
    '返品は配達から三十日以内であれば受け付けます。',
    'コーヒー豆は冷暗所で保存してください。冷蔵庫には入れないでください。',
  ]
  const index = buildKeywordIndex(pages)

  it('puts the right page first for a question in Japanese', () => {
    expect(searchKeyword(index, '配送はどのくらいかかりますか', 3)[0]?.ord).toBe(0)
    expect(searchKeyword(index, '返品したいのですが', 3)[0]?.ord).toBe(1)
    expect(searchKeyword(index, '豆の保存方法', 3)[0]?.ord).toBe(2)
  })
})

describe('bm25', () => {
  const corpus = [
    'Refund policy. We refund orders within 30 days of delivery.',
    'Shipping times vary by country and usually take three days.',
    'Our refund window does not cover custom engraved items.',
    'Contact support by email for anything else.',
  ]
  const index = buildKeywordIndex(corpus)

  it('ranks the most on-topic document first', () => {
    const hits = searchKeyword(index, 'how do I get a refund', 3)
    expect(hits[0]?.ord).toBe(0)
    expect(hits.length).toBeGreaterThan(1)
  })

  it('returns nothing when no term matches', () => {
    expect(searchKeyword(index, 'quantum chromodynamics', 5)).toEqual([])
  })

  it('scores a rare term above a common one', () => {
    const rare = searchKeyword(index, 'engraved', 5)
    const common = searchKeyword(index, 'days', 5)
    expect(rare[0]?.score).toBeGreaterThan(common[0]?.score ?? 0)
  })

  it('does not double count a term repeated in the query', () => {
    const once = searchKeyword(index, 'refund', 1)
    const twice = searchKeyword(index, 'refund refund refund', 1)
    expect(twice[0]?.score).toBeCloseTo(once[0]?.score ?? 0, 10)
  })

  it('handles an empty corpus without throwing', () => {
    expect(searchKeyword(buildKeywordIndex([]), 'anything', 5)).toEqual([])
  })
})

describe('vector index', () => {
  const vectors = [
    Float32Array.from([1, 0, 0, 0]),
    Float32Array.from([0, 1, 0, 0]),
    Float32Array.from([0.9, 0.1, 0, 0]),
  ]
  const index = buildVectorIndex(vectors, 'test')

  it('survives int8 quantisation with the ranking intact', () => {
    const hits = searchVector(index, Float32Array.from([1, 0, 0, 0]), 3)
    expect(hits[0]?.ord).toBe(0)
    expect(hits[1]?.ord).toBe(2)
    expect(hits[2]?.ord).toBe(1)
  })

  it('keeps quantisation error small enough to trust the score', () => {
    const [top] = searchVector(index, Float32Array.from([1, 0, 0, 0]), 1)
    expect(top?.score).toBeGreaterThan(0.99)
  })

  it('stores about one byte per dimension', () => {
    const wide = buildVectorIndex([new Float32Array(512).fill(0.04)], 'test')
    // base64 inflates by 4/3, so 512 dimensions land near 700 characters.
    expect(wide.data.length).toBeLessThan(720)
  })

  it('refuses a query of the wrong width rather than reading past the end', () => {
    expect(searchVector(index, Float32Array.from([1, 0]), 3)).toEqual([])
  })

  it('normalises to unit length', () => {
    const unit = normalize(Float32Array.from([3, 4]))
    expect(Math.hypot(unit[0] as number, unit[1] as number)).toBeCloseTo(1, 6)
  })

  it('leaves an all-zero vector alone instead of dividing by zero', () => {
    expect([...normalize(Float32Array.from([0, 0]))]).toEqual([0, 0])
  })
})

describe('reciprocal rank fusion', () => {
  it('promotes what both retrievers agree on', () => {
    const fused = fuse([
      { label: 'keyword', ids: ['a', 'b', 'c'] },
      { label: 'vector', ids: ['z', 'b', 'y'] },
    ])
    expect(fused[0]?.id).toBe('b')
    expect(fused[0]?.from.sort()).toEqual(['keyword', 'vector'])
  })

  it('still lets a confident single-list result outrank a weakly agreed one', () => {
    // Rank 1 on one list beats rank 3 plus rank 2 on the other. This is the
    // behaviour that makes fusion useful rather than a popularity contest.
    const fused = fuse([
      { label: 'keyword', ids: ['a', 'b', 'c'] },
      { label: 'vector', ids: ['c', 'b', 'z'] },
    ])
    expect(fused[0]?.id).toBe('c')
  })

  it('keeps single-list results, ranked below the agreed ones', () => {
    const fused = fuse([
      { label: 'keyword', ids: ['a'] },
      { label: 'vector', ids: ['b'] },
    ])
    expect(fused.map((result) => result.id).sort()).toEqual(['a', 'b'])
  })

  it('ignores score magnitude, using only rank', () => {
    const fused = fuse([{ label: 'keyword', ids: ['x', 'y'] }])
    expect(fused[0]?.score).toBeGreaterThan(fused[1]?.score ?? 0)
  })
})

describe('stemming collapses the forms a customer actually types', () => {
  const same = (a: string, b: string) => expect(tokenize(a)).toEqual(tokenize(b))

  it('handles a silent e lost to -ing', () => {
    same('pause', 'pausing')
    same('price', 'pricing')
  })

  it('handles a doubled consonant', () => {
    same('ship', 'shipping')
    same('ship', 'shipped')
    same('cancel', 'cancelling')
  })

  it('keeps genuinely different words apart', () => {
    expect(tokenize('refund')).not.toEqual(tokenize('refuse'))
    expect(tokenize('use')).not.toEqual(tokenize('us'))
    expect(tokenize('address')).toEqual(tokenize('addresses'))
  })
})
