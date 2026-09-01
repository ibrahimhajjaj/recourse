import { describe, expect, it } from 'vitest'
import { readClaims, resolveIdentity, signClaims } from '../src/identity.js'
import { renderProcedures } from '../src/procedures/index.js'
import { defineProcedure } from '../src/procedures/define.js'

const SECRET = 'a-server-side-secret'

describe('facts the model must never hold', () => {
  it('comes back exactly as it went in', async () => {
    const claims = { stripeId: 'cus_123', dob: '1990-04-02', tier: 'gold' }

    expect(await readClaims(await signClaims(claims, SECRET), SECRET)).toEqual(claims)
  })

  it('refuses a token signed with a different secret', async () => {
    const token = await signClaims({ stripeId: 'cus_123' }, 'someone-elses-secret')

    expect(await readClaims(token, SECRET)).toBeNull()
  })

  it('refuses a token somebody edited', async () => {
    // The whole point: a browser passes this through, so an unsigned bag of
    // facts from a browser is not a fact.
    const token = await signClaims({ tier: 'free' }, SECRET)
    const [body, signature] = token.split('.')
    const forged = `${btoa('{"tier":"gold"}').replace(/=+$/, '')}.${signature}`

    expect(await readClaims(forged, SECRET)).toBeNull()
    expect(await readClaims(`${body}.`, SECRET)).toBeNull()
  })

  it('refuses nonsense rather than throwing', async () => {
    for (const token of ['', 'not-a-token', 'a.b', '....', undefined]) {
      expect(await readClaims(token, SECRET), String(token)).toBeNull()
    }
  })

  it('refuses a body that is not an object', async () => {
    // An array or a string would reach an action as something it did not
    // expect and read as undefined field by field.
    for (const value of [['gold'], 'gold', 42, null]) {
      const token = await signClaims(value as never, SECRET)
      expect(await readClaims(token, SECRET), JSON.stringify(value)).toBeNull()
    }
  })
})

describe('the two tiers', () => {
  it('hands the claims to actions and keeps them off the contact', async () => {
    const token = await signClaims({ stripeId: 'cus_123' }, SECRET)
    const resolved = await resolveIdentity(
      { userId: 'u1', contact: { name: 'Amina' }, token },
      { secret: SECRET },
    )

    expect(resolved.private).toEqual({ stripeId: 'cus_123' })
    // Not on the contact, which is the half that reaches procedure text.
    expect(JSON.stringify(resolved.contact)).not.toContain('cus_123')
  })

  it('cannot be interpolated into a procedure', async () => {
    // The failure this prevents: a billing id put in `attributes` for an
    // action to use also lands in any procedure that names it.
    const procedure = defineProcedure({
      name: 'Billing',
      trigger: 'billing question',
      steps: ['Look up {{contact.stripeId}} and tell them the amount.'],
    })

    const rendered = renderProcedures([procedure], { contact: { id: 'u1', name: 'Amina' } })

    expect(rendered).not.toContain('cus_123')
  })

  it('carries the claims even when the user id did not verify', async () => {
    // The token carries its own proof, so it does not depend on the other half.
    const token = await signClaims({ tier: 'gold' }, SECRET)
    const resolved = await resolveIdentity({ userId: 'u1', userHash: 'wrong', token }, { secret: SECRET })

    expect(resolved.contact?.verified).toBe(false)
    expect(resolved.private).toEqual({ tier: 'gold' })
  })

  it('carries nothing when there is no secret to check against', async () => {
    const token = await signClaims({ tier: 'gold' }, SECRET)

    expect((await resolveIdentity({ userId: 'u1', token }, undefined)).private).toBeUndefined()
  })
})
