/**
 * Checking a deployment before a customer does.
 *
 * Every credential in this project is passed as an option rather than read
 * from the environment, which is the right shape and has one cost: nothing
 * validates it until a webhook arrives and fails. A wrong Slack signing secret
 * looks exactly like silence.
 *
 * So this asks each provider whether the credentials work, using the cheapest
 * call each one has. It reads nothing and changes nothing.
 */

export type Health = 'ok' | 'warn' | 'fail' | 'skip'

export interface Check {
  name: string
  status: Health
  /** One line. What is wrong, or what was confirmed. */
  detail: string
  /** What to do about it, when there is something to do. */
  fix?: string
}

export interface DoctorOptions {
  /** Where the knowledge index lives. */
  index?: string
  /** An OpenAI-compatible endpoint to check, such as a local Ollama. */
  baseURL?: string
  apiKey?: string
  model?: string
  embedModel?: string
  signal?: AbortSignal
}

/**
 * Credentials to verify, by provider.
 *
 * Only what the caller supplies is checked. An empty object checks the index
 * and the model, which is what most deployments have.
 */
export interface Credentials {
  slack?: { botToken: string }
  telegram?: { botToken: string }
  discord?: { botToken: string }
  whatsapp?: { accessToken: string; phoneNumberId?: string }
  twilio?: { accountSid: string; authToken: string }
  elevenlabs?: { apiKey: string }
  firecrawl?: { apiKey?: string }
}

/** A single provider check, so one failure never hides the rest. */
async function attempt(name: string, run: () => Promise<Check>): Promise<Check> {
  try {
    return await run()
  } catch (error) {
    return {
      name,
      status: 'fail',
      detail: `could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function head(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  // Ten seconds: long enough for a cold provider, short enough that a hung
  // endpoint does not make the whole check look broken.
  const timeout = AbortSignal.timeout(10_000)
  return fetch(url, { ...init, signal: signal ?? timeout })
}

export async function checkModel(options: DoctorOptions): Promise<Check[]> {
  const checks: Check[] = []

  if (!options.baseURL) {
    checks.push({
      name: 'model',
      status: 'skip',
      detail: 'no endpoint given, so the Vercel AI Gateway is assumed',
      fix: 'pass --base-url to check a local or self-hosted model',
    })
    return checks
  }

  const root = options.baseURL.replace(/\/+$/, '')

  checks.push(
    await attempt('model endpoint', async () => {
      const response = await head(`${root}/models`, {
        headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
      }, options.signal)

      if (!response.ok) {
        return {
          name: 'model endpoint',
          status: 'fail',
          detail: `${root} answered ${response.status}`,
          fix: response.status === 401 ? 'the API key was rejected' : 'check the URL is right and the service is up',
        }
      }

      const body = (await response.json()) as { data?: Array<{ id?: string }> }
      const available = (body.data ?? []).map((entry) => entry.id).filter(Boolean) as string[]

      // Naming the model that is missing, and what is there instead, saves the
      // round trip of going to look.
      for (const [label, wanted] of [
        ['model', options.model],
        ['embedding model', options.embedModel],
      ] as const) {
        if (!wanted) continue
        if (!available.some((id) => id === wanted || id.startsWith(`${wanted}:`))) {
          checks.push({
            name: label,
            status: 'fail',
            detail: `"${wanted}" is not on ${root}`,
            fix: available.length > 0 ? `available: ${available.slice(0, 6).join(', ')}` : 'the endpoint lists no models',
          })
          continue
        }
        checks.push({ name: label, status: 'ok', detail: `"${wanted}" is available` })
      }

      return { name: 'model endpoint', status: 'ok', detail: `${root} answered with ${available.length} models` }
    }),
  )

  return checks
}

export async function checkCredentials(credentials: Credentials, signal?: AbortSignal): Promise<Check[]> {
  const checks: Check[] = []

  if (credentials.slack) {
    checks.push(
      await attempt('slack', async () => {
        // auth.test is the cheapest call that proves a token works, and it
        // names the workspace, which catches a token for the wrong one.
        const response = await head('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: { Authorization: `Bearer ${credentials.slack?.botToken}` },
        }, signal)
        const body = (await response.json()) as { ok?: boolean; team?: string; error?: string }

        return body.ok
          ? { name: 'slack', status: 'ok', detail: `token works, workspace "${body.team}"` }
          : { name: 'slack', status: 'fail', detail: `Slack rejected the token: ${body.error}` }
      }),
    )
  }

  if (credentials.telegram) {
    checks.push(
      await attempt('telegram', async () => {
        const response = await head(
          `https://api.telegram.org/bot${credentials.telegram?.botToken}/getMe`,
          {},
          signal,
        )
        const body = (await response.json()) as { ok?: boolean; result?: { username?: string }; description?: string }

        return body.ok
          ? { name: 'telegram', status: 'ok', detail: `token works, bot @${body.result?.username}` }
          : { name: 'telegram', status: 'fail', detail: `Telegram rejected the token: ${body.description}` }
      }),
    )
  }

  if (credentials.discord) {
    checks.push(
      await attempt('discord', async () => {
        const response = await head('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${credentials.discord?.botToken}` },
        }, signal)

        if (!response.ok) {
          return { name: 'discord', status: 'fail', detail: `Discord answered ${response.status} for the bot token` }
        }

        const body = (await response.json()) as { username?: string }
        return { name: 'discord', status: 'ok', detail: `token works, bot ${body.username}` }
      }),
    )
  }

  if (credentials.whatsapp) {
    checks.push(
      await attempt('whatsapp', async () => {
        const id = credentials.whatsapp?.phoneNumberId
        const url = id
          ? `https://graph.facebook.com/v21.0/${id}`
          : 'https://graph.facebook.com/v21.0/me'

        const response = await head(url, {
          headers: { Authorization: `Bearer ${credentials.whatsapp?.accessToken}` },
        }, signal)
        const body = (await response.json()) as { error?: { message?: string }; display_phone_number?: string }

        if (body.error) {
          return { name: 'whatsapp', status: 'fail', detail: `Meta rejected it: ${body.error.message}` }
        }

        return {
          name: 'whatsapp',
          status: 'ok',
          detail: body.display_phone_number
            ? `token works, number ${body.display_phone_number}`
            : 'token works',
        }
      }),
    )
  }

  if (credentials.twilio) {
    checks.push(
      await attempt('twilio', async () => {
        const auth = btoa(`${credentials.twilio?.accountSid}:${credentials.twilio?.authToken}`)
        const response = await head(
          `https://api.twilio.com/2010-04-01/Accounts/${credentials.twilio?.accountSid}.json`,
          { headers: { Authorization: `Basic ${auth}` } },
          signal,
        )

        return response.ok
          ? { name: 'twilio', status: 'ok', detail: 'account sid and auth token work' }
          : { name: 'twilio', status: 'fail', detail: `Twilio answered ${response.status}` }
      }),
    )
  }

  if (credentials.elevenlabs) {
    checks.push(
      await attempt('elevenlabs', async () => {
        const response = await head('https://api.elevenlabs.io/v1/user/subscription', {
          headers: { 'xi-api-key': credentials.elevenlabs?.apiKey ?? '' },
        }, signal)

        if (!response.ok) {
          return { name: 'elevenlabs', status: 'fail', detail: `ElevenLabs answered ${response.status}` }
        }

        // Characters left is the thing that actually stops voice working, and
        // it fails silently mid-call rather than at startup.
        const body = (await response.json()) as { character_count?: number; character_limit?: number }
        const used = body.character_count ?? 0
        const cap = body.character_limit ?? 0
        const left = cap - used

        return left > 0 && left < cap * 0.1
          ? { name: 'elevenlabs', status: 'warn', detail: `key works, but only ${left} characters left of ${cap}` }
          : { name: 'elevenlabs', status: 'ok', detail: `key works, ${left} of ${cap} characters left` }
      }),
    )
  }

  if (credentials.firecrawl) {
    checks.push(
      await attempt('firecrawl', async () => {
        // Keyless works and is the documented default, so a missing key is
        // information rather than a problem.
        if (!credentials.firecrawl?.apiKey) {
          return {
            name: 'firecrawl',
            status: 'ok',
            detail: 'no key, which is fine: scrape and search are keyless',
            fix: 'a key raises the crawl limits',
          }
        }

        const response = await head('https://api.firecrawl.dev/v2/team/credit-usage', {
          headers: { Authorization: `Bearer ${credentials.firecrawl.apiKey}` },
        }, signal)

        return response.ok
          ? { name: 'firecrawl', status: 'ok', detail: 'key works' }
          : { name: 'firecrawl', status: 'fail', detail: `Firecrawl answered ${response.status}` }
      }),
    )
  }

  return checks
}

/** Formats a report for a terminal. Grouped by outcome, worst first. */
export function formatChecks(checks: Check[]): string {
  const symbol: Record<Health, string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL', skip: 'skip' }
  const order: Health[] = ['fail', 'warn', 'skip', 'ok']

  const lines = [...checks]
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
    .map((check) => {
      const head = `  ${symbol[check.status]}  ${check.name.padEnd(16)} ${check.detail}`
      return check.fix && check.status !== 'ok' ? `${head}\n${' '.repeat(24)}${check.fix}` : head
    })

  const failed = checks.filter((check) => check.status === 'fail').length
  const warned = checks.filter((check) => check.status === 'warn').length

  const summary = failed > 0
    ? `\n${failed} problem${failed === 1 ? '' : 's'} to fix before this serves a customer.`
    : warned > 0
      ? `\nNothing broken, ${warned} thing${warned === 1 ? '' : 's'} worth a look.`
      : '\nEverything checked is working.'

  return `${lines.join('\n')}\n${summary}`
}

/** Non-zero when something is actually broken. Warnings do not fail a script. */
export function exitCodeFor(checks: Check[]): number {
  return checks.some((check) => check.status === 'fail') ? 1 : 0
}
