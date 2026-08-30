import { verifyJwt } from './jwt.js'
import { acknowledge, answerInBackground, rejected, type ChannelBase, type InboundMessage } from './shared.js'

export interface TeamsOptions extends ChannelBase {
  /** The bot's Microsoft App ID, which inbound tokens must be addressed to. */
  appId: string
  /** The app password, used to get a token for sending replies. */
  appPassword: string
  /** Tenant for a single-tenant bot. Omitted for multi-tenant. */
  tenantId?: string
  send?: (activity: TeamsReplyTarget, text: string) => Promise<void>
  /** Skips token verification. Only for a local tunnel during development. */
  insecureSkipVerification?: boolean
}

export interface TeamsReplyTarget {
  serviceUrl: string
  conversationId: string
  activityId: string
  /**
   * Who the reply is from, meaning the bot.
   *
   * The Connector refuses a reply without it, with
   * `MissingProperty: The 'Activity.From' field is required`, and the bot's own
   * identity is not something it knows about itself: it arrives as the
   * `recipient` of the message being answered, because on the way in the bot is
   * who the message was addressed to.
   */
  from: { id: string; name?: string }
}

interface Activity {
  type?: string
  id?: string
  text?: string
  serviceUrl?: string
  conversation?: { id?: string }
  from?: { id?: string; name?: string; aadObjectId?: string }
  recipient?: { id?: string; name?: string }
}

const OPENID_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration'
const ISSUER = 'https://api.botframework.com'

/**
 * Microsoft Teams, through the Bot Framework.
 *
 * Two things make this different from every other channel here. Inbound
 * requests carry a signed JWT rather than an HMAC, so verification means
 * fetching Microsoft's public keys. And replies do not go back on the response:
 * they are posted to a per-conversation service URL with a token the bot has to
 * fetch for itself.
 */
export function teamsChannel(options: TeamsOptions) {
  /** Cached because it is valid for an hour and costs a round trip to get. */
  let token: { value: string; expiresAt: number } | null = null

  async function accessToken(): Promise<string> {
    const now = Date.now()
    if (token && now < token.expiresAt) return token.value

    const tenant = options.tenantId ?? 'botframework.com'
    const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.appId,
        client_secret: options.appPassword,
        scope: 'https://api.botframework.com/.default',
      }),
    })

    if (!response.ok) throw new Error(`Teams token request failed (${response.status})`)

    const body = (await response.json()) as { access_token?: string; expires_in?: number }
    if (!body.access_token) throw new Error('Teams token response had no access_token')

    // Refreshed a minute early, so a request never races the expiry.
    token = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 - 60_000 }
    return token.value
  }

  const send =
    options.send ??
    (async (target: TeamsReplyTarget, text: string) => {
      const url = `${target.serviceUrl.replace(/\/$/, '')}/v3/conversations/${encodeURIComponent(
        target.conversationId,
      )}/activities/${encodeURIComponent(target.activityId)}`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'message', text, from: target.from }),
      })

      if (!response.ok) throw new Error(`Teams reply failed: ${response.status} ${await response.text()}`)
    })

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const rawBody = await request.text()

    // Held past the verification block, because the address the token was
    // issued for can only be compared with the one the reply will use after
    // the body has been parsed.
    let addressed: string | undefined

    if (!options.insecureSkipVerification) {
      const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      if (!presented) return rejected('missing bearer token')

      const claims = await verifyJwt({
        token: presented,
        openIdUrl: OPENID_URL,
        issuer: ISSUER,
        audience: options.appId,
      })
      if (!claims) return rejected('bad token')

      // The last of Microsoft's verification steps, and the one that stops the
      // bot handing its own credentials to a stranger. The reply address comes
      // out of the request body, and the bot posts to it holding a bearer token
      // that can act as the bot. A signed token that says nothing about where
      // the reply goes leaves the body free to say anywhere. The token carries
      // the address it was issued for, so the two have to agree.
      addressed = normaliseUrl(String(claims.serviceurl ?? ''))
      if (!addressed) return rejected('service url does not match the token')
    }

    let activity: Activity
    try {
      activity = JSON.parse(rawBody) as Activity
    } catch {
      return acknowledge()
    }

    // Checked after the parse, against the field the reply is actually posted
    // to. Reading it out of the raw body instead compares a different value to
    // the one that gets used: JSON keeps the last of a repeated key while a
    // scan finds the first, so a body naming `serviceUrl` twice passes the
    // check on the first and is delivered to the second.
    if (addressed !== undefined && addressed !== normaliseUrl(activity.serviceUrl ?? '')) {
      return rejected('service url does not match the token')
    }

    const text = stripMentions(activity.text ?? '').trim()
    const conversationId = activity.conversation?.id
    const serviceUrl = activity.serviceUrl

    // Belt as well as braces, and the reason it is worth both: the check above
    // is skipped in development, and a bot that can be talked into posting its
    // token to an arbitrary host is a bot whose credentials are for the taking.
    // This one holds whatever the mode, so the worst a skipped verification can
    // cost is a wrong answer rather than the bot itself.
    if (serviceUrl && !isConnector(serviceUrl)) {
      return rejected('service url is not a Bot Connector address')
    }

    // Only messages. Teams also sends membership changes, typing and reactions.
    if (activity.type === 'message' && text && conversationId && serviceUrl && activity.id) {
      const inbound: InboundMessage = {
        conversationId: `teams:${conversationId}`,
        text,
        contact: { id: activity.from?.aadObjectId ?? activity.from?.id, name: activity.from?.name },
        // The bot is the recipient of what it is answering, so that is where
        // its own identity for the reply comes from. Falling back to the
        // configured app id covers a channel that leaves recipient off.
        reply: {
          serviceUrl,
          conversationId,
          activityId: activity.id,
          botId: activity.recipient?.id ?? options.appId,
          botName: activity.recipient?.name ?? '',
        },
      }

      answerInBackground(options, 'teams', inbound, async (answer, resolved) => {
        await send(
          {
            serviceUrl: resolved.reply.serviceUrl as string,
            conversationId: resolved.reply.conversationId as string,
            activityId: resolved.reply.activityId as string,
            from: {
              id: resolved.reply.botId as string,
              ...(resolved.reply.botName ? { name: resolved.reply.botName as string } : {}),
            },
          },
          answer,
        )
      })
    }

    return acknowledge()
  }
}

/**
 * Where the Bot Connector lives, and so the only place the bot's token may go.
 *
 * Microsoft is explicit that the token is a password and must not be put in a
 * request to any other service. The reply address arrives in the request body,
 * so without this the body chooses where the password is sent.
 */
const CONNECTOR_HOSTS = ['botframework.com', 'botframework.azure.us', 'smba.trafficmanager.net']

function isConnector(serviceUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(serviceUrl)
    if (protocol !== 'https:') return false
    const host = hostname.toLowerCase()
    return CONNECTOR_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}

/** Trailing slashes and case differ between the claim and the body. */
function normaliseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}


/** Teams puts `<at>Bot name</at>` in the text of every mention. */
export function stripMentions(text: string): string {
  return text.replace(/<at>[^<]*<\/at>/g, '').replace(/\s+/g, ' ')
}
