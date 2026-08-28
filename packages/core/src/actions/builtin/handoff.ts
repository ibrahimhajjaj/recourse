import { defineAction } from '../define.js'
import type { Action, ActionContext } from '../types.js'
import { fetchWithRetry } from '../../util/http.js'

/**
 * Handing the conversation to a person, live.
 *
 * Distinct from opening a ticket: a ticket is answered later, a live handoff
 * is answered now. Which one is right depends entirely on whether anybody is
 * actually there, which is why availability is a function the host supplies
 * rather than something this can guess.
 */
export interface LiveChatOptions {
  name?: string
  whenToUse?: string
  procedureOnly?: boolean
  /**
   * Whether a human is available right now. Returning false makes the agent
   * fall back to whatever else it has, rather than promising someone who is
   * asleep.
   */
  isAvailable?: (ctx: ActionContext) => boolean | Promise<boolean>
  /** Connects the conversation. Return anything the customer should be told. */
  connect: (
    request: { summary: string; conversationId?: string; email?: string; name?: string },
    ctx: ActionContext,
  ) => Promise<{ queuePosition?: number; message?: string } | void> | { queuePosition?: number; message?: string } | void
  /** Said when nobody is available. */
  unavailable?: string
}

export function liveChat(options: LiveChatOptions): Action {
  return defineAction({
    name: options.name ?? 'connect_to_a_person',
    whenToUse:
      options.whenToUse ??
      'Use when the customer asks to speak to a person right now, or when the conversation is going ' +
        'badly and a human would do better. Summarise the problem first so they do not have to repeat it.',
    procedureOnly: options.procedureOnly,
    collect: [
      {
        name: 'summary',
        type: 'string',
        description: 'What the customer needs, in one or two sentences, so a person can pick it up cold.',
      },
      { name: 'email', type: 'string', description: 'How to reach them if the chat drops.', required: false },
      { name: 'name', type: 'string', description: "The customer's name, if known.", required: false },
    ],

    async execute(input, ctx) {
      const available = options.isAvailable ? await options.isAvailable(ctx) : true

      if (!available) {
        const message =
          options.unavailable ??
          'Nobody is available to chat right now. Offer to open a ticket instead, or take their email.'
        return { connected: false, message }
      }

      const result = await options.connect(
        {
          summary: String(input.summary ?? ''),
          conversationId: ctx.conversationId,
          email: input.email ? String(input.email) : ctx.contact?.email,
          name: input.name ? String(input.name) : ctx.contact?.name,
        },
        ctx,
      )

      const queue = result && typeof result === 'object' ? result.queuePosition : undefined
      const message =
        (result && typeof result === 'object' ? result.message : undefined) ??
        (queue !== undefined
          ? `You are number ${queue} in the queue. Someone will be with you shortly.`
          : 'Connecting you to a person now.')

      ctx.emit({ type: 'handoff', message })
      return { connected: true, queuePosition: queue, message: `Tell the customer: ${message}` }
    },
  })
}

export interface TransferToPhoneOptions {
  name?: string
  whenToUse?: string
  procedureOnly?: boolean
  /** The number to forward to, in E.164 form. */
  phoneNumber: string
  /** Only offered inside these hours, in the host's timezone. */
  hours?: { open: number; close: number; days?: number[] }
  /**
   * Performs the transfer. On a voice call this updates the live call with
   * TwiML; in a chat there is nothing to transfer, so the number is offered
   * instead.
   */
  transfer?: (to: string, ctx: ActionContext) => Promise<void> | void
}

/**
 * Forwards a voice call to a person.
 *
 * On a text channel there is no call to forward, so this gives the customer the
 * number and the opening hours. Telling someone to "hold while I transfer you"
 * in a chat window is the kind of thing that makes a bot look stupid.
 */
export function transferToPhone(options: TransferToPhoneOptions): Action {
  return defineAction({
    name: options.name ?? 'transfer_to_a_phone_line',
    whenToUse:
      options.whenToUse ??
      'Use when the customer asks to speak to someone by phone, or when the problem clearly needs a ' +
        'conversation rather than messages.',
    procedureOnly: options.procedureOnly,
    collect: [
      { name: 'reason', type: 'string', description: 'Why they need to speak to someone.', required: false },
    ],

    async execute(_input, ctx) {
      if (options.hours && !withinHours(options.hours)) {
        return {
          transferred: false,
          phoneNumber: options.phoneNumber,
          message: `The phone line is closed right now. It opens at ${String(options.hours.open).padStart(2, '0')}:00. Offer to open a ticket instead.`,
        }
      }

      if (options.transfer) {
        await options.transfer(options.phoneNumber, ctx)
        ctx.emit({ type: 'handoff', message: 'Transferring you now.' })
        return { transferred: true, message: 'Tell the customer you are transferring them now.' }
      }

      ctx.emit({
        type: 'ui',
        kind: 'button',
        id: 'phone',
        data: { label: `Call ${options.phoneNumber}`, url: `tel:${options.phoneNumber}` },
      })
      return {
        transferred: false,
        phoneNumber: options.phoneNumber,
        message: `Give them the number ${options.phoneNumber}. A call button is already shown.`,
      }
    },
  })
}

function withinHours(hours: { open: number; close: number; days?: number[] }): boolean {
  const now = new Date()
  const day = now.getDay()
  // Monday to Friday unless the host says otherwise.
  if (!(hours.days ?? [1, 2, 3, 4, 5]).includes(day)) return false
  const hour = now.getHours()
  return hour >= hours.open && hour < hours.close
}

export interface SalesforceCaseOptions {
  /** Your instance, such as `https://acme.my.salesforce.com`. */
  instanceUrl: string
  /** An OAuth access token with permission to create cases. */
  accessToken: string
  apiVersion?: string
}

/**
 * Opens a Salesforce case, for teams whose queue lives there.
 *
 * Written as a ticket sink for `escalate` rather than its own action, so the
 * agent has one way to hand over regardless of where the ticket ends up.
 */
export function salesforceCases(options: SalesforceCaseOptions) {
  const version = options.apiVersion ?? 'v62.0'

  return async function createCase(ticket: {
    subject: string
    body: string
    email?: string
    name?: string
    priority?: string
  }): Promise<{ id?: string }> {
    const response = await fetchWithRetry(
      `${options.instanceUrl}/services/data/${version}/sobjects/Case`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Subject: ticket.subject,
          Description: ticket.body,
          SuppliedEmail: ticket.email,
          SuppliedName: ticket.name,
          Origin: 'Web',
          Priority: ticket.priority === 'urgent' ? 'High' : ticket.priority === 'low' ? 'Low' : 'Medium',
        }),
      },
      { attempts: 2 },
    )

    if (!response.ok) throw new Error(`Salesforce case creation failed (${response.status})`)
    const body = (await response.json()) as { id?: string }
    return { id: body.id }
  }
}
