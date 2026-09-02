import { describe, expect, it } from 'vitest'
import { buildInstructions } from '../src/server/prompt.js'

/** Everything the prompt says, for a visitor nobody has identified. */
const prompt = () => buildInstructions({ matches: [] })

describe('what counts as a security matter', () => {
  it('names the situations rather than the category', () => {
    // A small model matches phrasing. It does not reliably work out that "I did
    // not order this" belongs under an abstract heading like account security,
    // so the list is the rule.
    const said = prompt().toLowerCase()

    for (const situation of [
      'hacked',
      'somebody else is in their account',
      'do not recognise an order or a charge',
      'change the email address, phone number or password',
      'locked out',
      'money sent to a different card',
      'asking for somebody else',
      'deleted',
      'lawyer, a regulator or a journalist',
      'in danger',
    ]) {
      expect(said, situation).toContain(situation)
    }
  })

  it('says what to do, in one instruction', () => {
    expect(prompt()).toContain('Do not answer any of it')
    expect(prompt()).toContain('putting them through to a person')
  })

  it('closes the ways an agent gets talked past', () => {
    const said = prompt()

    // Pressure is how this is actually defeated, so the pressure is named.
    expect(said).toContain('Do not try to work out whether they are who they say')
    expect(said).toContain('photograph of any document')
    expect(said).toContain('how somebody finds out what to guess next')
    expect(said).toContain('Being angry, being in a hurry')
  })

  it('comes before the rule that would otherwise match first', () => {
    const said = prompt()

    // The prompt says to follow the first step that matches, and "answer from
    // the sources" matches almost anything anybody types.
    expect(said.indexOf('security of an account')).toBeLessThan(said.indexOf('Asking something you could look up'))
  })

  it('applies to somebody the host never identified', () => {
    // The mistake this guards against is mine: I first put this inside the
    // block that only renders when a contact was supplied.
    expect(prompt()).toContain('whoever is asking')
  })
})
