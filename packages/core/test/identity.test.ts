import { describe, expect, it } from 'vitest'
import { resolveIdentity, signIdentity, verifyIdentity } from '../src/identity.js'

const SECRET = 'a-secret-that-never-leaves-the-server'

describe('signing an identity', () => {
  it('produces the 64 character hex hash every other implementation produces', async () => {
    const hash = await signIdentity('user-123', SECRET)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic, so a host can cache it', async () => {
    expect(await signIdentity('user-123', SECRET)).toBe(await signIdentity('user-123', SECRET))
  })

  it('matches Node crypto, so existing server code keeps working', async () => {
    const { createHmac } = await import('node:crypto')
    const expected = createHmac('sha256', SECRET).update('user-123').digest('hex')
    expect(await signIdentity('user-123', SECRET)).toBe(expected)
  })

  it('changes completely when the user changes', async () => {
    expect(await signIdentity('user-123', SECRET)).not.toBe(await signIdentity('user-124', SECRET))
  })
})

describe('verifying an identity', () => {
  it('accepts a hash it signed', async () => {
    const hash = await signIdentity('user-123', SECRET)
    expect(await verifyIdentity('user-123', hash, SECRET)).toBe(true)
  })

  it('rejects a hash signed for someone else', async () => {
    const hash = await signIdentity('user-999', SECRET)
    expect(await verifyIdentity('user-123', hash, SECRET)).toBe(false)
  })

  it('rejects a hash signed with a different secret', async () => {
    const hash = await signIdentity('user-123', 'the-wrong-secret')
    expect(await verifyIdentity('user-123', hash, SECRET)).toBe(false)
  })

  it('accepts upper case hex, because hosts format it differently', async () => {
    const hash = await signIdentity('user-123', SECRET)
    expect(await verifyIdentity('user-123', hash.toUpperCase(), SECRET)).toBe(true)
  })

  it('rejects anything that is not a 64 character hash without hashing', async () => {
    expect(await verifyIdentity('user-123', '', SECRET)).toBe(false)
    expect(await verifyIdentity('user-123', 'short', SECRET)).toBe(false)
    expect(await verifyIdentity('user-123', 'x'.repeat(63), SECRET)).toBe(false)
  })
})

describe('resolving a claim from the browser', () => {
  it('marks a correctly signed visitor as verified', async () => {
    const userHash = await signIdentity('u1', SECRET)
    const { contact, rejected } = await resolveIdentity(
      { userId: 'u1', userHash, contact: { name: 'Sam' } },
      { secret: SECRET },
    )
    expect(contact).toMatchObject({ id: 'u1', name: 'Sam', verified: true })
    expect(rejected).toBe(false)
  })

  it('keeps an unsigned visitor but marks them unverified', async () => {
    const { contact, rejected } = await resolveIdentity({ userId: 'u1' }, { secret: SECRET })
    expect(contact?.verified).toBe(false)
    expect(rejected).toBe(false)
  })

  it('rejects an unsigned visitor once verification is required', async () => {
    const { rejected } = await resolveIdentity({ userId: 'u1' }, { secret: SECRET, required: true })
    expect(rejected).toBe(true)
  })

  it('rejects an anonymous visitor when verification is required', async () => {
    expect((await resolveIdentity(undefined, { secret: SECRET, required: true })).rejected).toBe(true)
  })

  it('allows anonymous visitors when no identity is configured', async () => {
    const { contact, rejected } = await resolveIdentity(undefined, undefined)
    expect(contact).toBeUndefined()
    expect(rejected).toBe(false)
  })

  it('never reports verified when no secret is configured', async () => {
    // Otherwise turning identity off would silently trust whatever the page says.
    const { contact } = await resolveIdentity({ userId: 'u1', userHash: 'x'.repeat(64) }, undefined)
    expect(contact?.verified).toBe(false)
  })

  it('cannot be spoofed by sending a forged hash', async () => {
    const { contact } = await resolveIdentity(
      { userId: 'admin', userHash: 'f'.repeat(64) },
      { secret: SECRET },
    )
    expect(contact?.verified).toBe(false)
  })
})
