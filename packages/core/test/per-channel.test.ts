import { describe, expect, it } from 'vitest'
import { buildInstructions } from '../src/server/prompt.js'

const persona = {
  name: 'Nadia',
  business: 'Lumen',
  instructions: 'Ask for an order number before looking anything up.',
  perChannel: {
    sms: 'No markdown and no lists. One or two short sentences.',
    phone: 'You are being read aloud. No citation markers.',
  },
}

const built = (channel?: string) =>
  buildInstructions({ persona, matches: [], ...(channel ? { channel } : {}) })

describe('the same agent answering somewhere else', () => {
  it('adds the rules for the channel it is answering on', () => {
    // Markdown is fine on the web and arrives as literal asterisks on SMS.
    expect(built('sms')).toContain('No markdown and no lists')
    expect(built('phone')).toContain('read aloud')
  })

  it('does not leak one channel’s rules into another', () => {
    expect(built('phone')).not.toContain('No markdown and no lists')
    expect(built('sms')).not.toContain('read aloud')
  })

  it('leaves a channel with no rules exactly as the persona was written', () => {
    expect(built('web')).not.toContain('No markdown')
    expect(built('web')).toContain('Ask for an order number')
  })

  it('is unchanged when no channel is given at all', () => {
    expect(built()).toContain('Ask for an order number')
    expect(built()).not.toContain('No markdown')
  })

  it('puts the channel rule after the general one, so the specific one wins', () => {
    const prompt = built('sms')

    expect(prompt.indexOf('No markdown')).toBeGreaterThan(prompt.indexOf('Ask for an order number'))
  })
})
