import { describe, expect, it } from 'vitest'
import { describeFailure } from '../src/diagnostics.js'

describe('classifying a provider failure', () => {
  const cases: Array<[string, string]> = [
    ['429 Too Many Requests', 'rate_limited'],
    ['You exceeded your current quota', 'quota_exhausted'],
    ['Incorrect API key provided: sk-abc', 'unauthorized'],
    ['Request timed out', 'timeout'],
    ["This model's maximum context length is 8192 tokens", 'too_large'],
    ['503 Service Unavailable', 'unavailable'],
    ['something nobody has seen before', 'unknown'],
  ]

  for (const [text, expected] of cases) {
    it(`reads "${text.slice(0, 30)}" as ${expected}`, () => {
      expect(describeFailure(new Error(text)).reason).toBe(expected)
    })
  }

  it('never puts the provider text in what the customer reads', () => {
    const diagnosis = describeFailure(new Error('Incorrect API key provided: sk-abc123456'))
    expect(diagnosis.message).not.toContain('sk-abc')
    expect(diagnosis.message).not.toContain('API key')
  })

  it('gives every failure a reference to quote', () => {
    expect(describeFailure(new Error('x')).reference).toMatch(/^[a-z0-9]{6}$/)
  })

  it('only suggests a fallback where another model could help', () => {
    expect(describeFailure(new Error('429')).fallbackWorthTrying).toBe(true)
    expect(describeFailure(new Error('quota exceeded')).fallbackWorthTrying).toBe(true)
    // A malformed request fails identically on every model.
    expect(describeFailure(new Error('something nobody has seen before')).fallbackWorthTrying).toBe(false)
  })
})
