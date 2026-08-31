/**
 * The live half of the email verification, without a provider.
 *
 * Every other channel here needs an account somebody has to create. Email does
 * not: a mail server is a thing you can run, and the adapter's two seams are a
 * function that reads the provider's body and a function that sends the reply,
 * so both ends can be pointed at a local one.
 *
 *   docker run -d --name recourse-mail -p 1025:1025 -p 8025:8025 axllent/mailpit
 *   npx tsx src/live-email.mts
 *
 * What this proves is a real message over real SMTP: a customer sends one, the
 * adapter reads what actually arrived rather than a fixture written from the
 * documentation, answers it, and the reply is delivered and read back off the
 * server. What it cannot prove is any particular provider's webhook shape,
 * which only that provider can, so the fixtures for Postmark, SendGrid and
 * Mailgun stay where they are.
 */

import { createConnection } from 'node:net'
import { buildIndex, createAgent, textSource } from '@recourse-ai/core'
import { emailChannel } from '@recourse-ai/core/channels'
import { memoryStore } from '@recourse-ai/core/store'
import { models } from '@recourse-ai/core/models'

const SMTP = { host: '127.0.0.1', port: 1025 }
const API = 'http://127.0.0.1:8025/api/v1'
const CUSTOMER = 'sam@example.com'
const SUPPORT = 'support@lumen.example'

/** Enough SMTP to post one message, so this needs no dependency to run. */
async function smtpSend(from: string, to: string, message: string): Promise<void> {
  const socket = createConnection(SMTP)
  const lines: string[] = []

  await new Promise<void>((resolve, reject) => {
    socket.on('error', reject)
    socket.setEncoding('utf8')

    const script = [
      `EHLO recourse.test`,
      `MAIL FROM:<${from}>`,
      `RCPT TO:<${to}>`,
      'DATA',
      // The dot on its own line ends the body, so any line that is just a dot
      // inside it has to be escaped or the message stops early.
      `${message.replace(/^\.$/gm, '..')}\r\n.`,
      'QUIT',
    ]

    let step = -1
    socket.on('data', (chunk: string) => {
      lines.push(chunk)
      if (/^[45]\d\d/.test(chunk)) return reject(new Error(`smtp refused: ${chunk.trim()}`))
      step += 1
      if (step < script.length) socket.write(`${script[step]}\r\n`)
    })
    socket.on('close', () => resolve())
  })
}

async function inbox(): Promise<Array<Record<string, any>>> {
  const response = await fetch(`${API}/messages`)
  if (!response.ok) throw new Error(`mailpit says ${response.status}. Is the container up?`)
  return ((await response.json()) as { messages: Array<Record<string, any>> }).messages
}

async function waitFor(
  matches: (message: Record<string, any>) => boolean,
  what: string,
): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = (await inbox()).find(matches)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`nothing matching ${what} arrived within a minute`)
}

async function main(): Promise<void> {
  // Said here rather than discovered as a reply that never arrives. Without a
  // model the turn fails inside the background answer, and the only symptom is
  // this script waiting a minute for an email nobody ever wrote.
  if (!process.env.OPENAI_COMPATIBLE_BASE_URL && !process.env.OPENAI_API_KEY) {
    throw new Error(
      'no model configured. Set OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL, ' +
        'for example http://localhost:11434/v1 and qwen3:4b against a local Ollama.',
    )
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

  const store = memoryStore()
  const sent: string[] = []

  const handle = emailChannel({
    agent: createAgent({
      index,
      embedder: false,
      store,
      model: models.fromEnvironment(process.env as Record<string, string | undefined>),
      persona: { name: 'Ada', business: 'Lumen Coffee Roasters' },
    }),
    // The reply goes back through the same server the question came from, so
    // the send path is exercised rather than counted.
    send: async (reply) => {
      const headers = [
        `From: ${SUPPORT}`,
        `To: ${reply.to}`,
        `Subject: ${reply.subject}`,
        ...(reply.inReplyTo ? [`In-Reply-To: ${reply.inReplyTo}`] : []),
        'Content-Type: text/plain; charset=utf-8',
      ]

      await smtpSend(SUPPORT, reply.to, `${headers.join('\r\n')}\r\n\r\n${reply.text}`)
      sent.push(reply.text)
    },
    onError: (error) => console.error('turn failed:', error),
  })

  console.log(`sending a question from ${CUSTOMER} over SMTP`)
  const subject = 'How long is delivery to Ireland?'
  await smtpSend(
    CUSTOMER,
    SUPPORT,
    [
      `From: Sam Fletcher <${CUSTOMER}>`,
      `To: ${SUPPORT}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Hello, how long does delivery to Ireland take? Thanks.',
    ].join('\r\n'),
  )

  const arrived = await waitFor((message) => message.Subject === subject, 'the question')
  console.log(`  ok    it reached the mail server  ${arrived.ID}`)

  // What the provider would post, built from the message that actually
  // arrived rather than from the documentation.
  const raw = await (await fetch(`${API}/message/${arrived.ID}`)).json()
  const body = {
    From: `${arrived.From.Name} <${arrived.From.Address}>`,
    To: SUPPORT,
    Subject: arrived.Subject,
    TextBody: (raw as { Text: string }).Text,
    MessageID: (raw as { MessageID?: string }).MessageID ?? arrived.ID,
    Headers: [] as unknown[],
  }

  const response = await handle(
    new Request('http://localhost/webhooks/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  console.log(`  ok    the adapter accepted the webhook  ${response.status}`)

  const reply = await waitFor(
    (message) => message.From.Address === SUPPORT && message.To.some((to: any) => to.Address === CUSTOMER),
    'the reply',
  )
  const text = await (await fetch(`${API}/message/${reply.ID}`)).json()
  console.log(`  ok    the answer was delivered back to the customer`)
  console.log(`\n  ${(text as { Text: string }).Text.trim().replace(/\n/g, '\n  ')}\n`)

  if (sent.length !== 1) throw new Error(`expected one reply, sent ${sent.length}`)

  // A reply that lands back in the same inbox is how a loop starts, and the
  // adapter has to refuse the machine it just wrote to.
  const before = sent.length
  await handle(
    new Request('http://localhost/webhooks/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, From: SUPPORT, To: `${CUSTOMER}, ${SUPPORT}` }),
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
  console.log(
    sent.length === before
      ? '  ok    a message from its own address is left alone'
      : '  FAIL  it answered itself, which is a mail loop',
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
