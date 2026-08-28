import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  safeEqual,
  signMeta,
  signSlack,
  signTwilio,
  verifyMeta,
  verifySlack,
  verifyTwilio,
} from '../src/channels/verify.js'

describe('constant time comparison', () => {
  it('matches identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
  })

  it('rejects a difference anywhere, including the last character', () => {
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'zbc')).toBe(false)
  })

  it('rejects different lengths', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('Meta signatures (WhatsApp, Messenger, Instagram)', () => {
  const secret = 'app-secret'
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })

  it('matches what Node crypto produces, so real Meta traffic verifies', async () => {
    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(await signMeta(body, secret)).toBe(expected)
  })

  it('accepts a genuine signature', async () => {
    expect(await verifyMeta(body, await signMeta(body, secret), secret)).toBe(true)
  })

  it('rejects a body that was tampered with in transit', async () => {
    const signature = await signMeta(body, secret)
    expect(await verifyMeta(`${body} `, signature, secret)).toBe(false)
  })

  it('rejects a signature made with a different app secret', async () => {
    expect(await verifyMeta(body, await signMeta(body, 'other-secret'), secret)).toBe(false)
  })

  it('rejects a missing or malformed header rather than throwing', async () => {
    expect(await verifyMeta(body, null, secret)).toBe(false)
    expect(await verifyMeta(body, 'sha1=abc', secret)).toBe(false)
    expect(await verifyMeta(body, 'garbage', secret)).toBe(false)
  })

  it('accepts an upper case hex digest', async () => {
    const signature = (await signMeta(body, secret)).toUpperCase().replace('SHA256=', 'sha256=')
    expect(await verifyMeta(body, signature, secret)).toBe(true)
  })
})

describe('Slack signatures', () => {
  const secret = '8f742231b10e8888abcd99yyyzzz85a5'
  const body = 'token=xyz&team_id=T1'
  const timestamp = '1531420618'

  it('matches the documented worked example', async () => {
    // The basestring is v0:timestamp:body, hashed with the signing secret.
    const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`
    expect(await signSlack(body, timestamp, secret)).toBe(expected)
  })

  it('accepts a fresh, genuine request', async () => {
    const signature = await signSlack(body, timestamp, secret)
    expect(
      await verifySlack({ signature, timestamp, rawBody: body, signingSecret: secret, now: Number(timestamp) }),
    ).toBe(true)
  })

  it('rejects a replayed request from six minutes ago', async () => {
    const signature = await signSlack(body, timestamp, secret)
    expect(
      await verifySlack({
        signature,
        timestamp,
        rawBody: body,
        signingSecret: secret,
        now: Number(timestamp) + 360,
      }),
    ).toBe(false)
  })

  it('rejects a request timestamped in the future by more than the window', async () => {
    const signature = await signSlack(body, timestamp, secret)
    expect(
      await verifySlack({
        signature,
        timestamp,
        rawBody: body,
        signingSecret: secret,
        now: Number(timestamp) - 360,
      }),
    ).toBe(false)
  })

  it('rejects a signature that is valid for a different timestamp', async () => {
    const signature = await signSlack(body, '1531420000', secret)
    expect(
      await verifySlack({ signature, timestamp, rawBody: body, signingSecret: secret, now: Number(timestamp) }),
    ).toBe(false)
  })

  it('rejects missing pieces rather than throwing', async () => {
    expect(await verifySlack({ signature: null, timestamp, rawBody: body, signingSecret: secret })).toBe(false)
    expect(await verifySlack({ signature: 'v0=x', timestamp: null, rawBody: body, signingSecret: secret })).toBe(
      false,
    )
    expect(
      await verifySlack({ signature: 'v0=x', timestamp: 'not-a-number', rawBody: body, signingSecret: secret }),
    ).toBe(false)
  })
})

describe('Twilio signatures', () => {
  const authToken = '12345'
  const url = 'https://example.com/myapp.php?foo=1&bar=2'
  const params = {
    Digits: '1234',
    To: '+18005551212',
    From: '+14158675310',
    Caller: '+14158675310',
    CallSid: 'CA1234567890ABCDE',
  }

  it('reproduces the documented worked example exactly', async () => {
    // Twilio's own docs give this signature for these inputs.
    expect(await signTwilio(url, params, authToken)).toBe('L/OH5YylLD5NRKLltdqwSvS0BnU=')
  })

  it('accepts a genuine signature', async () => {
    const signature = await signTwilio(url, params, authToken)
    expect(await verifyTwilio({ signature, url, params, authToken })).toBe(true)
  })

  it('rejects a signature made for a different url', async () => {
    const signature = await signTwilio('https://evil.example/', params, authToken)
    expect(await verifyTwilio({ signature, url, params, authToken })).toBe(false)
  })

  it('rejects when a parameter was changed', async () => {
    const signature = await signTwilio(url, params, authToken)
    expect(await verifyTwilio({ signature, url, params: { ...params, Digits: '9999' }, authToken })).toBe(false)
  })

  it('sorts by byte order, not locale, so casing cannot reorder fields', async () => {
    // A locale-aware sort puts "a" before "B"; Twilio's does not.
    const mixed = { B: '2', a: '1' }
    const signature = await signTwilio(url, mixed, authToken)
    expect(await verifyTwilio({ signature, url, params: mixed, authToken })).toBe(true)
  })

  it('rejects a missing header', async () => {
    expect(await verifyTwilio({ signature: null, url, params, authToken })).toBe(false)
  })
})
