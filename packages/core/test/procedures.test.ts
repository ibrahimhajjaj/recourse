import { describe, expect, it, vi } from 'vitest'
import {
  defineProcedure,
  referencedActions,
  renderProcedures,
  resolveVariables,
  unlockedBy,
  usableProcedures,
} from '../src/procedures/index.js'
import { actionsToTools, defineAction, escalate } from '../src/actions/index.js'
import type { Action } from '../src/actions/types.js'

const lookup = defineAction({ name: 'lookup_order', whenToUse: 'x', execute: async () => ({}) })
const refund = defineAction({
  name: 'issue_refund',
  whenToUse: 'x',
  procedureOnly: true,
  execute: async () => ({}),
})

const refundProcedure = defineProcedure({
  name: 'Refund request',
  trigger: 'The customer wants a refund or to send an order back',
  steps: [
    'Ask for the order number if you do not have it.',
    'Call @lookup_order with the order number.',
    {
      branches: [
        { if: 'the order is under 30 days old', then: 'Call @issue_refund and confirm the amount.' },
        { if: 'the order is a wholesale order over 5kg', then: 'Explain it is final sale.' },
      ],
      otherwise: 'Explain the 30 day window has passed and offer a replacement.',
    },
    'Confirm to {{contact.name}} what will happen next.',
  ],
})

describe('defining a procedure', () => {
  it('rejects one with no steps', () => {
    expect(() => defineProcedure({ name: 'x', trigger: 'y', steps: [] })).toThrow(/no steps/)
  })

  it('rejects one with no trigger, since it could never fire', () => {
    expect(() => defineProcedure({ name: 'x', trigger: '  ', steps: ['do a thing'] })).toThrow(/trigger/)
  })

  it('refuses a procedure longer than a model will reliably follow', () => {
    const steps = Array.from({ length: 16 }, (_, i) => `step ${i}`)
    expect(() => defineProcedure({ name: 'x', trigger: 'y', steps })).toThrow(/limit is 15/)
  })

  it('refuses a decision with too many branches', () => {
    expect(() =>
      defineProcedure({
        name: 'x',
        trigger: 'y',
        steps: [{ branches: Array.from({ length: 6 }, () => ({ if: 'a', then: 'b' })) }],
      }),
    ).toThrow(/more than 5 branches/)
  })

  it('finds every action a procedure names, including inside branches', () => {
    expect([...referencedActions(refundProcedure)].sort()).toEqual(['issue_refund', 'lookup_order'])
  })
})

describe('procedures that cannot run', () => {
  it('drops one whose action is missing rather than running half of it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { usable, dropped } = usableProcedures([refundProcedure], [lookup])
    expect(usable).toEqual([])
    expect(dropped[0]?.missing).toEqual(['issue_refund'])
    warn.mockRestore()
  })

  it('keeps one whose actions are all present', () => {
    const { usable } = usableProcedures([refundProcedure], [lookup, refund])
    expect(usable).toHaveLength(1)
  })

  it('skips a procedure that was switched off', () => {
    const off = { ...refundProcedure, enabled: false }
    expect(usableProcedures([off], [lookup, refund]).usable).toEqual([])
  })
})

describe('procedure-only actions', () => {
  it('stay hidden from the agent when no procedure references them', () => {
    const tools = actionsToTools([lookup, refund], { context: { emit: () => {} } })
    expect(Object.keys(tools)).toEqual(['lookup_order'])
  })

  it('become callable once a procedure that uses them is active', () => {
    const unlocked = unlockedBy(usableProcedures([refundProcedure], [lookup, refund]).usable)
    const tools = actionsToTools([lookup, refund], { context: { emit: () => {} }, unlocked })
    expect(Object.keys(tools).sort()).toEqual(['issue_refund', 'lookup_order'])
  })
})

describe('variables', () => {
  const scope = { contact: { name: 'Sam', email: 'sam@example.com', attributes: { plan: 'pro' } } }

  it('resolves contact details', () => {
    expect(resolveVariables('Hello {{contact.name}}', scope)).toBe('Hello Sam')
    expect(resolveVariables('Write to {{user.email}}', scope)).toBe('Write to sam@example.com')
  })

  it('resolves custom attributes with or without the prefix', () => {
    expect(resolveVariables('{{contact.custom_attributes.plan}}', scope)).toBe('pro')
    expect(resolveVariables('{{contact.plan}}', scope)).toBe('pro')
  })

  it('never leaves raw braces for the model to repeat at a customer', () => {
    const rendered = resolveVariables('Hi {{contact.name}}', { contact: {} })
    expect(rendered).not.toContain('{{')
    expect(rendered).toBe('Hi (not known)')
  })

  it('resolves host-supplied extras', () => {
    expect(resolveVariables('Agents available: {{agentAvailable}}', { extra: { agentAvailable: true } })).toBe(
      'Agents available: true',
    )
  })
})

describe('rendering procedures for the prompt', () => {
  const rendered = renderProcedures([refundProcedure], { contact: { name: 'Sam' } })

  it('numbers the steps in order', () => {
    expect(rendered).toContain('1. Ask for the order number')
    expect(rendered).toContain('2. Call @lookup_order')
  })

  it('renders branches as an ordered decision', () => {
    expect(rendered).toContain('If the order is under 30 days old')
    expect(rendered).toContain('Otherwise if the order is a wholesale order')
    expect(rendered).toContain('Otherwise: Explain the 30 day window')
  })

  it('resolves variables inside the steps', () => {
    expect(rendered).toContain('Confirm to Sam')
  })

  it('states the trigger so the agent knows when it applies', () => {
    expect(rendered).toContain('Trigger: The customer wants a refund')
  })

  it('renders nothing at all when there are no procedures', () => {
    expect(renderProcedures([], {})).toBe('')
  })
})

describe('a procedure with a real escalation action', () => {
  it('accepts the built-in action names', () => {
    const handoff: Action = escalate({ createTicket: () => ({ id: 'T-1' }) })
    const procedure = defineProcedure({
      name: 'Angry customer',
      trigger: 'The customer is upset or asking for a person',
      steps: ['Apologise once, briefly.', 'Call @escalate_to_human with what you have learned.'],
    })
    expect(usableProcedures([procedure], [handoff]).usable).toHaveLength(1)
  })
})
