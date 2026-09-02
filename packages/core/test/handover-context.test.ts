import { describe, expect, it } from 'vitest'
import { escalate, ticketBody, type EscalationRequest } from '../src/actions/builtin/escalate.js'
import { memoryStore } from '../src/store/memory.js'
import { message } from '../src/store/conformance.js'
import { INSIGHT_KEYS } from '../src/insights.js'
import type { ActionContext } from '../src/actions/types.js'

const base: EscalationRequest = { subject: 'Refund not received', body: 'They want their money back.' }

describe('what a person reads when they pick the ticket up', () => {
  it('leads with the summary and the mood, not with the transcript', () => {
    const body = ticketBody({
      ...base,
      summary: 'Refund promised on the 3rd, never arrived.',
      mood: 'unhappy',
      transcript: 'Customer: where is my refund\nAgent: let me look',
    })

    // Both decide whether this is picked up now or in an hour, and reading four
    // hundred words of transcript to work that out is the cost being removed.
    expect(body.indexOf('Summary:')).toBeLessThan(body.indexOf('Conversation so far'))
    expect(body).toContain('Customer seems: unhappy')
  })

  it('says what was already tried, and what failed', () => {
    const body = ticketBody({
      ...base,
      tried: [
        { action: 'lookup_order', ok: true },
        { action: 'issue_refund', ok: false, detail: 'the payment provider timed out' },
      ],
    })

    // Without this the human cannot tell a lookup that failed from one nobody
    // attempted, and their first reply asks for an order number the agent
    // already checked.
    expect(body).toContain('lookup_order: ok')
    expect(body).toContain('issue_refund: failed, the payment provider timed out')
  })

  it('is just the body when there is nothing else to add', () => {
    expect(ticketBody(base)).toBe('They want their money back.')
  })
})

describe('gathering that context from the conversation', () => {
  const raise = async (context: Partial<ActionContext>) => {
    let raised: EscalationRequest | undefined
    const action = escalate({ createTicket: (ticket) => void (raised = ticket) })

    await action.execute!(
      { subject: 'Refund not received', body: 'They want their money back.' },
      { emit: () => {}, ...context } as ActionContext,
    )

    return raised
  }

  it('carries what ran, the mood and the summary off the stored conversation', async () => {
    const store = memoryStore()
    await store.appendMessage('c1', message({ content: 'where is my refund' }))
    await store.appendMessage(
      'c1',
      message({
        role: 'assistant',
        content: 'Let me check.',
        actions: [
          { name: 'lookup_order', input: { order: 'LUM-1' }, output: { ok: true, data: {} } },
          { name: 'issue_refund', input: {}, output: { ok: false, error: 'provider timed out' } },
        ],
      }),
    )

    const thread = await store.getConversation('c1')
    await store.updateConversation('c1', {
      meta: {
        ...(thread?.conversation.meta ?? {}),
        [INSIGHT_KEYS.mood]: 'unhappy',
        [INSIGHT_KEYS.summary]: 'Refund promised and never arrived.',
      },
    })

    const ticket = await raise({ store, conversationId: 'c1' })

    expect(ticket?.mood).toBe('unhappy')
    expect(ticket?.summary).toBe('Refund promised and never arrived.')
    expect(ticket?.tried?.map((attempt) => attempt.action)).toEqual(['lookup_order', 'issue_refund'])
    expect(ticket?.tried?.[1]).toMatchObject({ ok: false, detail: 'provider timed out' })
  })

  it('still opens the ticket when the store cannot be read', async () => {
    // A ticket that failed to open because a summary could not be fetched would
    // be the worst possible trade.
    const broken = {
      getConversation: async () => {
        throw new Error('the database is asleep')
      },
    }

    const ticket = await raise({ store: broken as never, conversationId: 'c1' })

    expect(ticket?.subject).toBe('Refund not received')
    expect(ticket?.tried).toBeUndefined()
  })
})
