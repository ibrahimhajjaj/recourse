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

  it('hands anything touching the account to a person', () => {
    const instructions = buildInstructions({ matches: [], contact: { ...sam, verified: true } })

    // His point, and the right one: a human on a desk helps from the record and
    // knows the moment something stops being a question and starts being a
    // security matter.
    for (const trigger of ['password change', 'payment detail', 'they have been hacked']) {
      expect(instructions.toLowerCase()).toContain(trigger.toLowerCase().split(' ')[0] as string)
    }

    expect(instructions).toContain('goes to a')
    expect(instructions).toContain('Do not verify them yourself')
  })

  it('adds nothing for a contact carrying no facts', () => {
    // An email address alone is not a record, and a heading with nothing under
    // it is prompt nobody needed.
    expect(buildInstructions({ matches: [], contact: { email: 'sam@shop.example' } })).not.toContain(
      'Who you are talking to',
    )
  })
})
