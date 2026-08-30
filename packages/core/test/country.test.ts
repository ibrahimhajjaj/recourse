import { describe, expect, it } from 'vitest'
import { consented, countryFrom } from '../src/server/country.js'

const asking = (headers: Record<string, string>) => new Request('https://shop.example/chat', { headers })

/**
 * The point of reading a header the edge already set is that no address is
 * ever received, so there is nothing to leak, nothing to store, and no
 * database to keep current. These check the reading, and that nothing is
 * invented when there is nothing to read.
 */
describe('where the visitor is', () => {
  it('reads what each edge network calls it', () => {
    expect(countryFrom(asking({ 'cf-ipcountry': 'IE' }))).toBe('IE')
    expect(countryFrom(asking({ 'x-vercel-ip-country': 'de' }))).toBe('DE')
    expect(countryFrom(asking({ 'cloudfront-viewer-country': 'GB' }))).toBe('GB')
  })

  it('says nothing behind an origin that resolves nothing', () => {
    expect(countryFrom(asking({}))).toBeUndefined()
  })

  it('refuses the placeholders that are not places', () => {
    // Cloudflare sends XX when it cannot tell and T1 for Tor. Counting either
    // as a country puts a bar on a chart for somewhere nobody is.
    expect(countryFrom(asking({ 'cf-ipcountry': 'XX' }))).toBeUndefined()
    expect(countryFrom(asking({ 'cf-ipcountry': 'T1' }))).toBeUndefined()
    expect(countryFrom(asking({ 'cf-ipcountry': 'UNKNOWN' }))).toBeUndefined()
  })
})

describe('consent, which is the host to decide', () => {
  const analytics = consented('analytics')

  it('agrees only when the purpose was named', () => {
    expect(analytics(asking({ 'x-helpdeck-consent': 'analytics' }))).toBe(true)
    expect(analytics(asking({ 'x-helpdeck-consent': 'necessary, Analytics , ads' }))).toBe(true)
  })

  it('treats a missing header as no', () => {
    // Silence is not consent, and this is the direction the mistake has to
    // fall in: the cost of getting it wrong the other way is a lawful basis
    // nobody has.
    expect(analytics(asking({}))).toBe(false)
    expect(analytics(asking({ 'x-helpdeck-consent': '' }))).toBe(false)
    expect(analytics(asking({ 'x-helpdeck-consent': 'necessary' }))).toBe(false)
  })
})
