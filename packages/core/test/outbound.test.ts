import { describe, expect, it } from 'vitest'
import { renderTemplate, runCampaign, validateRecipients } from '../src/outbound/index.js'
import { memoryStore } from '../src/store/index.js'

const consented = (to: string, extra: Record<string, unknown> = {}) => ({ to, consented: true, ...extra })

describe('templates', () => {
  it('substitutes the name and any variables', () => {
    const message = renderTemplate('Hi {{name}}, order {{order}} shipped.', {
      to: '+1',
      name: 'Sam',
      consented: true,
      variables: { order: 'LUM-1001' },
    })
    expect(message).toBe('Hi Sam, order LUM-1001 shipped.')
  })

  it('leaves an unknown variable empty rather than printing braces at a customer', () => {
    expect(renderTemplate('Hi {{name}}, {{missing}}!', { to: '+1', consented: true })).toBe('Hi , !')
  })
})

describe('who gets contacted', () => {
  it('skips anyone who did not consent, because the default has to be no', () => {
    const { ok, skipped } = validateRecipients([
      { to: '+1', consented: true },
      { to: '+2' },
      { to: '+3', consented: false },
    ])
    expect(ok.map((r) => r.to)).toEqual(['+1'])
    expect(skipped).toHaveLength(2)
    expect(skipped.every((entry) => entry.reason === 'no consent')).toBe(true)
  })

  it('sends once to someone listed twice', () => {
    const { ok, skipped } = validateRecipients([consented('+1'), consented('+1')])
    expect(ok).toHaveLength(1)
    expect(skipped[0]?.reason).toBe('duplicate')
  })

  it('skips a row with no address', () => {
    const { skipped } = validateRecipients([{ to: '   ', consented: true }])
    expect(skipped[0]?.reason).toBe('no address')
  })
})

describe('running a campaign', () => {
  it('sends to everyone eligible and reports what happened', async () => {
    const sent: Array<{ to: string; message: string }> = []

    const result = await runCampaign({
      name: 'Roast day',
      channel: 'whatsapp',
      template: 'Hi {{name}}, this week we roast on Wednesday.',
      recipients: [consented('+1', { name: 'Sam' }), consented('+2', { name: 'Ada' }), { to: '+3' }],
      send: async (to, message) => void sent.push({ to, message }),
    })

    expect(result.sent).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.skippedReasons['no consent']).toBe(1)
    expect(sent[0]?.message).toContain('Hi Sam')
  })

  it('records the send, so a repeat run can see who was already contacted', async () => {
    const store = memoryStore()

    await runCampaign({
      name: 'Roast day',
      channel: 'sms',
      template: 'Hello {{name}}',
      recipients: [consented('+15551234', { name: 'Sam' })],
      store,
      send: async () => {},
    })

    const found = await store.getConversation('sms:+15551234')
    expect(found?.messages[0]?.content).toBe('Hello Sam')
    expect(found?.conversation.meta?.campaign).toBe('Roast day')
  })

  it('collects failures without abandoning the rest of the list', async () => {
    const result = await runCampaign({
      name: 'Roast day',
      channel: 'sms',
      template: 'Hello',
      recipients: [consented('+1'), consented('+2'), consented('+3')],
      abortAfterFailures: 99,
      send: async (to) => {
        if (to === '+2') throw new Error('number unreachable')
      },
    })

    expect(result.sent).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.failures[0]).toMatchObject({ to: '+2', error: 'number unreachable' })
  })

  it('stops early when too much is failing, rather than burning the whole list', async () => {
    let attempts = 0

    const result = await runCampaign({
      name: 'Roast day',
      channel: 'sms',
      template: 'Hello',
      recipients: Array.from({ length: 50 }, (_, i) => consented(`+${i}`)),
      concurrency: 1,
      abortAfterFailures: 3,
      send: async () => {
        attempts++
        throw new Error('provider rejected the number')
      },
    })

    expect(result.aborted).toBe(true)
    // Stopped near the threshold rather than trying all fifty.
    expect(attempts).toBeLessThan(10)
  })

  it('reports progress as it goes', async () => {
    const seen: number[] = []

    await runCampaign({
      name: 'Roast day',
      channel: 'sms',
      template: 'Hello',
      recipients: [consented('+1'), consented('+2')],
      concurrency: 1,
      send: async () => {},
      onProgress: (progress) => void seen.push(progress.sent),
    })

    expect(seen).toEqual([1, 2])
  })

  it('handles an empty list without sending anything', async () => {
    const result = await runCampaign({
      name: 'Empty',
      channel: 'sms',
      template: 'Hello',
      recipients: [],
      send: async () => {
        throw new Error('should never be called')
      },
    })
    expect(result).toMatchObject({ sent: 0, failed: 0, total: 0 })
  })
})
