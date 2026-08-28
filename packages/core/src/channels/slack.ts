import { verifySlack } from './verify.js'
import { acknowledge, answerInBackground, rejected, type ChannelBase, type InboundMessage } from './shared.js'

export interface SlackOptions extends ChannelBase {
  signingSecret: string
  botToken: string
  /**
   * Answer every message in a channel, not just mentions. Off by default,
   * because a bot that replies to everything in a busy channel is a bot the
   * team mutes within the hour.
   */
  respondToAllMessages?: boolean
  send?: (channel: string, text: string, threadTs?: string) => Promise<void>
}

interface SlackEnvelope {
  type?: string
  challenge?: string
  event?: {
    type?: string
    subtype?: string
    text?: string
    user?: string
    channel?: string
    ts?: string
    thread_ts?: string
    bot_id?: string
  }
}

/**
 * Slack, over the Events API.
 *
 * Replies land in a thread rather than the channel, which keeps a support
 * exchange from burying everything else people are talking about.
 */
export function slackChannel(options: SlackOptions) {
  const send =
    options.send ??
    (async (channel: string, text: string, threadTs?: string) => {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel, text, thread_ts: threadTs }),
      })

      // Slack answers 200 with ok:false, so the status alone proves nothing.
      const body = (await response.json()) as { ok?: boolean; error?: string }
      if (!body.ok) throw new Error(`Slack send failed: ${body.error ?? 'unknown error'}`)
    })

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const rawBody = await request.text()
    const verified = await verifySlack({
      signature: request.headers.get('x-slack-signature'),
      timestamp: request.headers.get('x-slack-request-timestamp'),
      rawBody,
      signingSecret: options.signingSecret,
    })
    if (!verified) return rejected('bad signature')

    let envelope: SlackEnvelope
    try {
      envelope = JSON.parse(rawBody) as SlackEnvelope
    } catch {
      return acknowledge()
    }

    // The handshake Slack performs when you first point it at a URL.
    if (envelope.type === 'url_verification' && envelope.challenge) {
      return new Response(JSON.stringify({ challenge: envelope.challenge }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const message = extract(envelope, options.respondToAllMessages === true)
    if (message) {
      answerInBackground(options, 'slack', message, async (text, inbound) => {
        await send(inbound.reply.channel as string, text, inbound.reply.threadTs)
      })
    }

    return acknowledge()
  }
}

function extract(envelope: SlackEnvelope, all: boolean): InboundMessage | null {
  const event = envelope.event
  if (!event) return null

  // Anything the bot itself said, or an edit or deletion, would otherwise
  // bounce straight back in and the two of them would talk forever.
  if (event.bot_id || event.subtype) return null

  const wanted = all ? ['message', 'app_mention'] : ['app_mention']
  if (!event.type || !wanted.includes(event.type)) return null

  // Strip the leading <@U123> so the model does not read its own handle as
  // part of the question.
  const text = (event.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim()
  if (!text || !event.channel) return null

  const threadTs = event.thread_ts ?? event.ts

  return {
    // One conversation per thread, so replies keep their own history.
    conversationId: `slack:${event.channel}:${threadTs}`,
    text,
    contact: event.user ? { id: event.user } : undefined,
    reply: { channel: event.channel, threadTs: threadTs ?? '' },
  }
}
