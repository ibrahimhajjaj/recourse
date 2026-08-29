import { describe, expect, it } from 'vitest'
import { presign, signHeaders, sha256Hex, encodeRfc3986, EMPTY_SHA256 } from '../src/storage/sigv4.js'

// AWS publishes worked examples with the signature they expect. Reproducing
// one is the only way to know the algorithm is right without a server, and it
// keeps working in CI where there is no server to ask.
const AWS_EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}
const SCOPE = { region: 'us-east-1', service: 's3' }
const WHEN = new Date('2013-05-24T00:00:00Z')

describe('signature v4', () => {
  it('reproduces the presigned GET from the S3 documentation', async () => {
    const url = await presign({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      expiresIn: 86_400,
      credentials: AWS_EXAMPLE,
      scope: SCOPE,
      now: WHEN,
    })

    expect(new URL(url).searchParams.get('X-Amz-Signature')).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    )
  })

  it('hashes an empty body to the value S3 expects', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(EMPTY_SHA256)
  })

  it('encodes the characters encodeURIComponent leaves alone', () => {
    expect(encodeRfc3986("a!b'c(d)e*f")).toBe('a%21b%27c%28d%29e%2Af')
  })

  it('signs host and the amz headers, and says so', async () => {
    const headers = await signHeaders({
      method: 'PUT',
      url: 'https://example.r2.cloudflarestorage.com/bucket/key.png',
      payloadHash: EMPTY_SHA256,
      credentials: AWS_EXAMPLE,
      scope: { region: 'auto', service: 's3' },
      now: WHEN,
    })

    expect(headers.authorization).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20130524/auto/s3/aws4_request')
    expect(headers.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date')
    expect(headers['x-amz-date']).toBe('20130524T000000Z')
  })
})
