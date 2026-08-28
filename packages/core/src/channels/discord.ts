import { acknowledge, answerInBackground, rejected, type ChannelBase, type InboundMessage } from './shared.js'

export interface DiscordOptions extends ChannelBase {
  /** The application's public key, from the Discord developer portal. */
  publicKey: string
  applicationId: string
  botToken?: string
  send?: (interactionToken: string, text: string) => Promise<void>
}

interface Interaction {
  type?: number
  id?: string
  token?: string
  data?: { name?: string; options?: Array<{ name?: string; value?: unknown }> }
  member?: { user?: { id?: string; username?: string } }
  user?: { id?: string; username?: string }
  channel_id?: string
}

const PING = 1
const APPLICATION_COMMAND = 2
const PONG = 1
const DEFERRED_REPLY = 5

/**
 * Discord slash commands.
 *
 * Discord signs with Ed25519 rather than HMAC, and it is strict about it: an
 * application that ever answers an invalid signature with anything other than
 * 401 fails verification and gets its endpoint disabled.
 *
 * It also demands a reply within three seconds, which no model meets, so this
 * defers immediately and edits the placeholder once the answer exists.
 */
export function discordChannel(options: DiscordOptions) {
  const send =
    options.send ??
    (async (interactionToken: string, text: string) => {
      const response = await fetch(
        `https://discord.com/api/v10/webhooks/${options.applicationId}/${interactionToken}/messages/@original`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text.slice(0, 2000) }),
        },
      )
      if (!response.ok) throw new Error(`Discord reply failed: ${response.status} ${await response.text()}`)
    })

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const rawBody = await request.text()
    const verified = await verifyDiscord(
      rawBody,
      request.headers.get('x-signature-ed25519'),
      request.headers.get('x-signature-timestamp'),
      options.publicKey,
    )
    if (!verified) return rejected('bad signature')

    let interaction: Interaction
    try {
      interaction = JSON.parse(rawBody) as Interaction
    } catch {
      return rejected('bad body')
    }

    // Discord pings the endpoint periodically to check it is still alive.
    if (interaction.type === PING) {
      return Response.json({ type: PONG })
    }

    if (interaction.type === APPLICATION_COMMAND) {
      const question = interaction.data?.options?.find((option) => option.name === 'question')?.value
      const text = typeof question === 'string' ? question.trim() : ''
      const user = interaction.member?.user ?? interaction.user

      if (text && interaction.token) {
        const inbound: InboundMessage = {
          conversationId: `discord:${interaction.channel_id ?? user?.id ?? 'unknown'}`,
          text,
          contact: { id: user?.id, name: user?.username },
          reply: { token: interaction.token },
        }

        answerInBackground(options, 'discord', inbound, async (answer, resolved) => {
          await send(resolved.reply.token as string, answer)
        })
      }

      // "Thinking…" now, the real answer when the model is done.
      return Response.json({ type: DEFERRED_REPLY })
    }

    return acknowledge()
  }
}

/** Ed25519 over `timestamp + body`, with the public key as raw hex. */
export async function verifyDiscord(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKey: string,
): Promise<boolean> {
  if (!signature || !timestamp) return false

  try {
    const key = await crypto.subtle.importKey('raw', fromHex(publicKey), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      fromHex(signature),
      new TextEncoder().encode(timestamp + rawBody),
    )
  } catch {
    // A malformed key or signature is a failed verification, not a crash.
    return false
  }
}

/**
 * Built over an explicit ArrayBuffer so the result satisfies BufferSource. A
 * bare `new Uint8Array(n)` is generic over ArrayBufferLike, which includes
 * SharedArrayBuffer and so is not accepted by Web Crypto.
 */
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error('odd-length hex')
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('bad hex')
    bytes[i] = byte
  }
  return bytes
}
