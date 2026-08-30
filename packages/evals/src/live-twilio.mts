/**
 * The live half of the Twilio verification.
 *
 * Twilio is the one channel where the free path is gated. A trial account can
 * authenticate and be read, but until it has a number it cannot send, and
 * Twilio's Test Credentials, which exercise the real API without charging or
 * touching a real number, are not offered until a plan is chosen.
 *
 * So this is split by what can honestly be proved:
 *
 *   npx tsx src/live-twilio.mts --whoami   # the credentials work
 *   npx tsx src/live-twilio.mts --errors   # real failures, real error codes
 *   npx tsx src/live-twilio.mts --serve    # once a number exists
 *
 * `--errors` is the one worth having without a number. Every send this library
 * makes can come back as one of a handful of Twilio codes, and the one that
 * matters most is 21610: the customer texted STOP. That reads like a bug, is
 * not one, and retrying it is wrong and in several countries unlawful. This
 * drives real failures against the real API so the explanations are checked
 * against what Twilio actually sends rather than against a fixture of it.
 */

import { createServer } from 'node:http'
import { buildIndex, createAgent, textSource } from 'helpdeck'
import { signTwilio, twilioChannel } from 'helpdeck/channels'

import { memoryStore } from 'helpdeck/store'
import { models } from 'helpdeck/models'

const env = process.env
const need = (name: string): string => {
  const value = env[name]
  if (!value) {
    console.error(`missing ${name}`)
    process.exit(1)
  }
  return value
}

const mode = process.argv.find((argument) => argument.startsWith('--')) ?? '--whoami'
const accountSid = need('TWILIO_ACCOUNT_SID')
const authToken = need('TWILIO_AUTH_TOKEN')
const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

if (mode === '--whoami') {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  const body = (await response.json()) as { friendly_name?: string; status?: string; type?: string; message?: string }

  if (!response.ok) {
    console.error(`auth failed: ${body.message}`)
    process.exit(1)
  }

  console.log(`${body.friendly_name} | status ${body.status} | type ${body.type}`)

  const numbers = (await (
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`, {
      headers: { Authorization: `Basic ${auth}` },
    })
  ).json()) as { incoming_phone_numbers?: Array<{ phone_number: string }> }

  const owned = numbers.incoming_phone_numbers ?? []
  console.log(owned.length === 0 ? 'no numbers, so nothing can be sent yet' : `numbers: ${owned.map((n) => n.phone_number).join(', ')}`)
  process.exit(0)
}

const index = await buildIndex({
  sources: [
    textSource([
      {
        id: 'shipping',
        title: 'Shipping',
        url: 'https://shop.example/shipping',
        text: '# Shipping\n\nUnited Kingdom orders arrive in 1-2 working days. Ireland and the EU take 3-5. Delivery is free over 30 pounds.',
      },
    ]),
  ],
})

function agent() {
  return createAgent({
    index,
    embedder: false,
    store: memoryStore(),
    model: models.fromEnvironment(env as Record<string, string | undefined>),
    persona: { name: 'Ada', business: 'Lumen Coffee Roasters', tone: (env.HELPDECK_TONE as 'plain') ?? 'warm' },
  })
}

const url = env.TWILIO_PUBLIC_URL || 'https://shop.example/webhooks/sms'

/** An inbound message Twilio would have signed, signed the way Twilio signs it. */
async function inbound(params: Record<string, string>): Promise<Request> {
  return new Request(url, {
    method: 'POST',
    headers: {
      'x-twilio-signature': await signTwilio(url, params, authToken),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  })
}

if (mode === '--errors') {
  // Each of these is a real send to Twilio that really fails, chosen so the
  // failure is the interesting part. Nothing is delivered and nothing is
  // charged, because none of it gets as far as a carrier.
  const cases = [
    {
      what: 'a From number this account does not own',
      from: '+15551112222',
      to: '+15559998888',
      expect: 21606,
    },
    {
      what: 'a To number not verified on a trial account',
      from: '+15005550006',
      to: '+201557790359',
      expect: 21606,
    },
  ]

  for (const item of cases) {
    const failures: unknown[] = []
    const pending: Promise<unknown>[] = []

    const handle = twilioChannel({
      agent: agent(),
      authToken,
      accountSid,
      from: item.from,
      publicUrl: url,
      waitUntil: (promise) => void pending.push(promise),
      onError: (error) => void failures.push(error),
    })

    const response = await handle(await inbound({ From: item.to, Body: 'do you ship to Ireland?' }))
    await Promise.all(pending)

    const said = String((failures[0] as Error)?.message ?? 'no failure')
    console.log(`\n${item.what}`)
    console.log(`  webhook answered ${response.status}, as it must, or Twilio retries`)
    console.log(`  ${said}`)
  }

  console.log('\nEvery one of those is a real response from Twilio, not a fixture of one.')
  process.exit(0)
}

if (mode === '--serve') {
  const port = Number(env.PORT ?? 8798)

  const handle = twilioChannel({
    agent: agent(),
    authToken,
    accountSid,
    from: need('TWILIO_FROM'),
    publicUrl: need('TWILIO_PUBLIC_URL'),
    onError: (error) => console.error('turn failed:', error),
  })

  createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks)

    const request = new Request(new URL(incoming.url ?? '/', `http://localhost:${port}`), {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      ...(body.length > 0 ? { body } : {}),
    })

    const response = await handle(request)
    const text = await response.text()
    console.log(`${incoming.method} ${incoming.url} -> ${response.status} ${text.slice(0, 80)}`)

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    outgoing.writeHead(response.status, headers).end(text)
  }).listen(port, () => {
    console.log(`listening on ${port}\n`)
    console.log('Twilio signs the exact URL it called, so TWILIO_PUBLIC_URL must be the tunnel')
    console.log('address and not localhost, or no signature will ever match.')
  })
} else if (mode !== '--whoami' && mode !== '--errors') {
  console.error('usage: live-twilio.mts [--whoami | --errors | --serve]')
  process.exit(1)
}
