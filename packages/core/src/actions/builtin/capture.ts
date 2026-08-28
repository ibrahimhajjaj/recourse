import { defineAction } from '../define.js'
import type { Action, ActionContext, ActionField, ActionInput } from '../types.js'

export interface CollectLeadsOptions {
  /** Defaults to name, email and a message. */
  fields?: ActionField[]
  whenToUse?: string
  /**
   * Where the lead goes on top of the store: a CRM, an email, a webhook.
   * Optional, because a lead the agent captured but nobody saved is worse than
   * no lead at all, so it is written to the agent's store either way.
   */
  onLead?(values: Record<string, unknown>, ctx: ActionContext): Promise<void> | void
}

const DEFAULT_LEAD_FIELDS: ActionField[] = [
  { name: 'name', type: 'string', description: "The customer's full name.", required: false },
  { name: 'email', type: 'string', description: "The customer's email address." },
  {
    name: 'message',
    type: 'string',
    description: 'What the customer wants, in their own words.',
    required: false,
  },
]

/**
 * Captures a lead mid-conversation.
 *
 * The agent gathers the fields in conversation rather than dropping a form in
 * front of someone who came to ask a question, which is the whole reason this
 * is an action and not a widget.
 */
export function collectLeads(options: CollectLeadsOptions): Action {
  return defineAction({
    name: 'collect_lead',
    whenToUse:
      options.whenToUse ??
      'Use when the customer asks to be contacted, requests a demo, quote or callback, or ' +
        'wants something that needs a person to follow up. Ask for the details naturally, one ' +
        'or two at a time, and never invent them.',
    collect: options.fields ?? DEFAULT_LEAD_FIELDS,
    async execute(input: ActionInput, ctx) {
      const values = clean(input)

      await ctx.store?.saveLead({
        id: `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        conversationId: ctx.conversationId,
        createdAt: new Date().toISOString(),
        values,
      })

      await options.onLead?.(values, ctx)
      ctx.emit({ type: 'captured', kind: 'lead', name: 'lead', values })
      return { saved: true, message: 'Lead recorded. Thank the customer and say someone will follow up.' }
    },
  })
}

export interface CollectDataOptions {
  /** Tool name, so several of these can coexist. Lowercase with underscores. */
  name: string
  whenToUse: string
  fields: ActionField[]
  onData?(values: Record<string, unknown>, ctx: ActionContext): Promise<void> | void
  /** Told to the agent to say once the data is in. */
  confirmation?: string
  /** Keeps it off the agent's own initiative; only a procedure can call it. */
  procedureOnly?: boolean
}

/** The general form of lead capture: any set of fields, gathered in chat. */
export function collectData(options: CollectDataOptions): Action {
  return defineAction({
    name: options.name,
    whenToUse: options.whenToUse,
    collect: options.fields,
    procedureOnly: options.procedureOnly,
    async execute(input: ActionInput, ctx) {
      const values = clean(input)
      await options.onData?.(values, ctx)
      ctx.emit({ type: 'captured', kind: 'data', name: options.name, values })
      return { saved: true, message: options.confirmation ?? 'Details recorded. Confirm briefly.' }
    },
  })
}

/** Drops keys the model left empty so a blank string is never stored as an answer. */
function clean(input: ActionInput): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    values[key] = value
  }
  return values
}
