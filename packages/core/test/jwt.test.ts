import { describe, expect, it } from 'vitest'
import { clearKeyCache, verifyJwt } from '../src/channels/jwt.js'
import { stripMentions } from '../src/channels/teams.js'

const ISSUER = 'https://api.botframework.com'
const AUDIENCE = 'app-id-123'

function toBase64Url(bytes: Uint8Array | string): string {
  const binary =
    typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes as unknown as ArrayLike<number>))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A real RSA keypair, so signatures are genuinely verified rather than faked. */
async function issuer() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair

  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { n?: string; e?: string }
  const keys = [{ kid: 'key-1', kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256' }]

  async function sign(claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
    const head = toBase64Url(JSON.stringify({ alg: 'RS256', kid: 'key-1', typ: 'JWT', ...header }))
    const body = toBase64Url(JSON.stringify(claims))
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      pair.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    )
    return `${head}.${body}.${toBase64Url(new Uint8Array(signature))}`
  }

  return { keys, sign }
}

const now = 1_800_000_000_000
const valid = { iss: ISSUER, aud: AUDIENCE, exp: Math.floor(now / 1000) + 600, nbf: Math.floor(now / 1000) - 10 }

describe('verifying a bot framework token', () => {
  it('accepts a correctly signed, current token', async () => {
    const { keys, sign } = await issuer()
    const claims = await verifyJwt({
      token: await sign(valid),
      openIdUrl: 'unused',
      issuer: ISSUER,
      audience: AUDIENCE,
      keys,
      now,
    })
    expect(claims?.iss).toBe(ISSUER)
  })

  it('rejects a token whose body was edited after signing', async () => {
    const { keys, sign } = await issuer()
    const token = await sign(valid)
    const [head, , signature] = token.split('.')
    const forged = `${head}.${toBase64Url(JSON.stringify({ ...valid, aud: 'someone-else' }))}.${signature}`

    expect(
      await verifyJwt({ token: forged, openIdUrl: 'unused', issuer: ISSUER, audience: AUDIENCE, keys, now }),
    ).toBeNull()
  })

  it('rejects alg "none", the classic forgery', async () => {
    const { keys } = await issuer()
    const token = `${toBase64Url(JSON.stringify({ alg: 'none', kid: 'key-1' }))}.${toBase64Url(
      JSON.stringify(valid),
    )}.`

    expect(
      await verifyJwt({ token, openIdUrl: 'unused', issuer: ISSUER, audience: AUDIENCE, keys, now }),
    ).toBeNull()
  })

  it('rejects an HMAC algorithm, which would let the public key be the secret', async () => {
    const { keys } = await issuer()
    const token = `${toBase64Url(JSON.stringify({ alg: 'HS256', kid: 'key-1' }))}.${toBase64Url(
      JSON.stringify(valid),
    )}.anything`

    expect(
      await verifyJwt({ token, openIdUrl: 'unused', issuer: ISSUER, audience: AUDIENCE, keys, now }),
    ).toBeNull()
  })

  it('rejects a token signed by a key it does not know', async () => {
    const mine = await issuer()
    const theirs = await issuer()

    expect(
      await verifyJwt({
        token: await theirs.sign(valid),
        openIdUrl: 'unused',
        issuer: ISSUER,
        audience: AUDIENCE,
        keys: mine.keys,
        now,
      }),
    ).toBeNull()
  })

  it('rejects an expired token', async () => {
    const { keys, sign } = await issuer()
    const token = await sign({ ...valid, exp: Math.floor(now / 1000) - 600 })
    expect(
      await verifyJwt({ token, openIdUrl: 'unused', issuer: ISSUER, audience: AUDIENCE, keys, now }),
    ).toBeNull()
  })

  it('rejects a token that is not valid yet', async () => {
    const { keys, sign } = await issuer()
    const token = await sign({ ...valid, nbf: Math.floor(now / 1000) + 600 })
    expect(
      await verifyJwt({ token, openIdUrl: 'unused', issuer: ISSUER, audience: AUDIENCE, keys, now }),
    ).toBeNull()
  })

  it('rejects a token minted for a different bot', async () => {
    const { keys, sign } = await issuer()
    const token = await sign({ ...valid, aud: 'another-app' })
    expect(
      await verifyJwt({ token, openIdUrl: 'unused', issuer: ISSUER, audience: AUDIENCE, keys, now }),
    ).toBeNull()
  })

  it('rejects a token from the wrong issuer', async () => {
    const { keys, sign } = await issuer()
    const token = await sign({ ...valid, iss: 'https://evil.example' })
    expect(
      await verifyJwt({ token, openIdUrl: 'unused', issuer: ISSUER, audience: AUDIENCE, keys, now }),
    ).toBeNull()
  })

  it('rejects something that is not a token at all', async () => {
    const { keys } = await issuer()
    for (const token of ['', 'nonsense', 'a.b', 'a.b.c.d']) {
      expect(
        await verifyJwt({ token, openIdUrl: 'unused', issuer: ISSUER, audience: AUDIENCE, keys, now }),
      ).toBeNull()
    }
  })

  it('tolerates a little clock skew, since servers disagree', async () => {
    const { keys, sign } = await issuer()
    const token = await sign({ ...valid, exp: Math.floor(now / 1000) - 30 })
    expect(
      await verifyJwt({
        token,
        openIdUrl: 'unused',
        issuer: ISSUER,
        audience: AUDIENCE,
        keys,
        now,
        leewaySeconds: 60,
      }),
    ).not.toBeNull()
  })
})

describe('teams message text', () => {
  it('strips the bot mention Teams puts in every message', () => {
    expect(stripMentions('<at>Nadia</at> do you do refunds?')).toBe(' do you do refunds?')
  })

  it('leaves ordinary text alone', () => {
    expect(stripMentions('do you do refunds?')).toBe('do you do refunds?')
  })
})

describe('key caching', () => {
  it('can be cleared, for key rotation', () => {
    expect(() => clearKeyCache()).not.toThrow()
  })
})
