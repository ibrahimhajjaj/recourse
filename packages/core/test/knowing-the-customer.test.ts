import { describe, expect, it } from 'vitest'
import { buildInstructions } from '../src/server/prompt.js'

const sam = {
  name: 'Sam Okafor',
  email: 'sam@shop.example',
  attributes: { plan: 'Starter', customerSince: '2024' },
}

describe('what the agent knows about who is asking', () => {
  it('says nothing at all about a stranger', () => {
    // An anonymous visitor has to produce exactly the prompt they always did.
    const anonymous = buildInstructions({ matches: [] })

    expect(anonymous).not.toContain('Who you are talking to')
  })

  it('has the record in front of it when the host supplies one', () => {
    const instructions = buildInstructions({ matches: [], contact: { ...sam, verified: true } })

    expect(instructions).toContain('Who you are talking to')
    expect(instructions).toContain('Sam Okafor')
    expect(instructions).toContain('plan: Starter')
  })

  it('tells it to use the record to fit the answer, not to recite it', () => {
    const instructions = buildInstructions({ matches: [], contact: { ...sam, verified: true } })

    // The failure being avoided: a model handed an account record reads it out.
    expect(instructions).toContain('Never list these facts')
    expect(instructions).toContain('do not offer them something their plan')
  })

  it('treats an unconfirmed identity as a claim, not a fact', () => {
    const claimed = buildInstructions({ matches: [], contact: sam })
    const proven = buildInstructions({ matches: [], contact: { ...sam, verified: true } })

    // Anybody can type an email address. Until something checked it, the record
    // is a hint for phrasing and nothing that can be acted on.
    expect(claimed).toContain('NOT confirmed')
    expect(claimed).toContain('never act on it')
    expect(proven).toContain('identity is confirmed')
    expect(proven).not.toContain('NOT confirmed')
  })

  it('does not repeat the security rule, which applies to everybody', () => {
    // Handing over on account security is a step in the prompt proper. Somebody
    // with no account at all can still say they have been hacked, so putting it
    // here would have given it only to visitors the host happened to identify.
    const withRecord = buildInstructions({ matches: [], contact: { ...sam, verified: true } })
    const anonymous = buildInstructions({ matches: [] })

    expect(anonymous).toContain('hacked')
    expect(withRecord.split('hacked').length).toBe(2)
  })

  it('adds nothing for a contact carrying no facts', () => {
    // An email address alone is not a record, and a heading with nothing under
    // it is prompt nobody needed.
    expect(buildInstructions({ matches: [], contact: { email: 'sam@shop.example' } })).not.toContain(
      'Who you are talking to',
    )
  })
})
