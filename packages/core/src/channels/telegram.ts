import { acknowledge, answerInBackground, rejected, type ChannelBase, type InboundMessage } from './shared.js'

export interface TelegramOptions extends ChannelBase {
  botToken: string
  /**
   * The secret you passed to setWebhook. Telegram sends it back on every
   * update, and it is the only thing standing between your bot and anyone who
   * guesses the URL.
   */
  secretToken: string
  apiBase?: string
  send?: (chatId: number | string, text: string, replyTo?: number) => Promise<void>
}

interface TelegramUpdate {
  message?: {
    message_id?: number
    text?: string
    chat?: { id?: number | string; type?: string }
    from?: { id?: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }
  }
}

/**
 * Telegram bots.
 *
 * Telegram does not sign its webhooks, so the secret token header is the whole
 * of the authentication. Setting one is not optional here.
 */
export function telegramChannel(options: TelegramOptions) {
  const base = options.apiBase ?? `https://api.telegram.org/bot${options.botToken}`

  const send =
    options.send ??
    (async (chatId: number | string, text: string, replyTo?: number) => {
      const response = await fetch(`${base}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4096),
          reply_to_message_id: replyTo,
        }),
      })

      const body = (await response.json()) as { ok?: boolean; description?: string }
      if (!body.ok) throw new Error(`Telegram send failed: ${body.description ?? response.status}`)
    })

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    if (request.headers.get('x-telegram-bot-api-secret-token') !== options.secretToken) {
      return rejected('bad secret token')
    }

    let update: TelegramUpdate
    try {
      update = (await request.json()) as TelegramUpdate
    } catch {
      return acknowledge()
    }

    const message = update.message
    const text = message?.text?.trim()
    const chatId = message?.chat?.id

    // A bot answering a bot is a loop nobody notices until the bill arrives.
    if (text && chatId !== undefined && !message?.from?.is_bot) {
      const name = [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(' ')
      const inbound: InboundMessage = {
        conversationId: `telegram:${chatId}`,
        text,
        contact: { id: String(message?.from?.id ?? chatId), name: name || message?.from?.username },
        reply: { chatId: String(chatId), replyTo: String(message?.message_id ?? '') },
      }

      answerInBackground(options, 'telegram', inbound, async (answer, resolved) => {
        const replyTo = Number.parseInt(resolved.reply.replyTo ?? '', 10)
        await send(resolved.reply.chatId as string, answer, Number.isFinite(replyTo) ? replyTo : undefined)
      })
    }

    return acknowledge()
  }
}
