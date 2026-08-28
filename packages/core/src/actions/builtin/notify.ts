import { defineAction } from '../define.js'
import type { Action } from '../types.js'
import { fetchWithRetry } from '../../util/http.js'

export interface SlackNotifyOptions {
  name?: string
  whenToUse?: string
  /** An incoming webhook url from a Slack app. */
  webhookUrl: string
  /** Prefixed to every message, so a channel knows where it came from. */
  prefix?: string
  procedureOnly?: boolean
}

/**
 * Posts a note into Slack.
 *
 * Useful for the things a team wants to know about immediately but that do not
 * warrant a ticket: an angry customer, a question about a product that is not
 * launched yet, someone asking for a feature three times a day.
 */
export function slackNotify(options: SlackNotifyOptions): Action {
  return defineAction({
    name: options.name ?? 'notify_the_team',
    whenToUse:
      options.whenToUse ??
      'Use to flag something the team should see straight away: an unhappy customer, a possible bug, ' +
        'or a question you could not answer that keeps coming up. Do not use it for routine questions.',
    procedureOnly: options.procedureOnly,
    collect: [
      { name: 'message', type: 'string', description: 'What the team needs to know, in one or two sentences.' },
    ],

    async execute(input, ctx) {
      const prefix = options.prefix ? `${options.prefix} ` : ''
      const conversation = ctx.conversationId ? `\n_conversation:_ \`${ctx.conversationId}\`` : ''

      const response = await fetchWithRetry(
        options.webhookUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `${prefix}${String(input.message ?? '')}${conversation}` }),
        },
        { signal: ctx.signal, attempts: 2 },
      )

      if (!response.ok) throw new Error(`Slack notification failed (${response.status})`)

      ctx.emit({ type: 'action', name: 'notify_the_team', status: 'done' })
      return { notified: true, message: 'The team has been told. Do not promise a response time.' }
    },
  })
}

export interface BookingOptions {
  name?: string
  whenToUse?: string
  /** Your cal.com or Calendly scheduling link. */
  url: string
  provider?: 'cal.com' | 'calendly'
  procedureOnly?: boolean
}

/**
 * Offers a booking link.
 *
 * Deliberately not an availability lookup and a write. Both providers can do
 * that, but a bot that books a slot on someone's calendar from a chat message
 * needs to be right about time zones, double bookings and cancellations, and
 * handing over a link is right every time.
 */
export function scheduleMeeting(options: BookingOptions): Action {
  const provider = options.provider ?? 'cal.com'

  return defineAction({
    name: options.name ?? 'offer_a_booking_link',
    whenToUse:
      options.whenToUse ??
      'Use when the customer wants a call, a demo, a consultation, or to speak to someone at a specific time.',
    procedureOnly: options.procedureOnly,
    collect: [
      {
        name: 'reason',
        type: 'string',
        description: 'What the meeting is about, in a few words.',
        required: false,
      },
    ],

    async execute(input, ctx) {
      ctx.emit({
        type: 'ui',
        kind: 'button',
        id: 'booking',
        data: { label: 'Pick a time', url: options.url, provider },
      })
      return {
        shown: true,
        reason: input.reason ?? null,
        message: 'A booking link is displayed. Tell them to pick a time that suits them.',
      }
    },
  })
}
