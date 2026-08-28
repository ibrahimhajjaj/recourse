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
    expect(tokenize('كيف يمكنني الإلغاء')).toEqual(['كيف', 'يمكنني', 'الإلغاء'])
  })

  it('ignores punctuation and single characters', () => {
    expect(tokenize('a b -- ??? refund!!')).toEqual(['refund'])
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
