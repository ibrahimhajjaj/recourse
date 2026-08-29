/**
 * The live half of the WhatsApp verification, in one command.
 *
 * Everything here needs credentials, and the credentials are free: Meta's test
 * number comes with the app, needs no business verification and no payment
 * method, and takes about twenty minutes to get. `--serve` is the receiving
 * half and wants a tunnel; `--send` is the sending half and does not.
 *
 *   WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... WHATSAPP_WABA_ID=... \
 *     npx tsx src/live-whatsapp.mts --templates
 *
 *   WHATSAPP_TO=447700900123 npx tsx src/live-whatsapp.mts --send
 *
 *   META_APP_SECRET=... META_VERIFY_TOKEN=... npx tsx src/live-whatsapp.mts --serve
 */

import { createServer } from 'node:http'
import { buildIndex, createAgent, textSource } from 'helpdeck'
import {
  listTemplates,
  sendTemplate,
  whatsappChannel,
  type MessageTemplate,
} from 'helpdeck/channels'
import { memoryStore } from 'helpdeck/store'
import { models } from 'helpdeck/models'

const env = process.env
const need = (name: string): string => {
  const value = env[name]
  if (!value) {
    console.error(`missing ${name}. See examples/nextjs/.env.example for what each one is.`)
    process.exit(1)
  }
  return value
}

const mode = process.argv.find((argument) => argument.startsWith('--')) ?? '--templates'

if (mode === '--templates') {
  const templates = await listTemplates({
    wabaId: need('WHATSAPP_WABA_ID'),
    accessToken: need('WHATSAPP_TOKEN'),
  })

  console.log(`${templates.length} approved template(s) on ${env.WHATSAPP_WABA_ID}\n`)

  for (const template of templates) {
    const placeholders = template.variables
      .map((variable: MessageTemplate['variables'][number]) => `{{${variable.position}}}${variable.example ? ` eg ${variable.example}` : ''}`)
      .join(', ')

    console.log(`  ${template.name}  ${template.language}  ${template.category ?? ''}`)
    if (placeholders) console.log(`    ${placeholders}`)
  }

  // hello_world ships pre-approved on a test number, so its absence means the
  // token is pointed at the wrong account rather than that nothing exists.
  if (!templates.some((template: MessageTemplate) => template.name === 'hello_world')) {
    console.log('\nNo hello_world. On a Meta test number that usually means WHATSAPP_WABA_ID is not this token\'s account.')
  }

  process.exit(0)
}

if (mode === '--send') {
  const known = await listTemplates({
    wabaId: need('WHATSAPP_WABA_ID'),
    accessToken: need('WHATSAPP_TOKEN'),
  })

  const name = env.WHATSAPP_TEMPLATE ?? 'hello_world'
  const started = Date.now()

  const result = await sendTemplate({
    accessToken: need('WHATSAPP_TOKEN'),
    phoneNumberId: need('WHATSAPP_PHONE_ID'),
    to: need('WHATSAPP_TO'),
    template: {
      name,
      ...(env.WHATSAPP_TEMPLATE_LANGUAGE ? { language: env.WHATSAPP_TEMPLATE_LANGUAGE } : {}),
      ...(env.WHATSAPP_TEMPLATE_VARS ? { variables: env.WHATSAPP_TEMPLATE_VARS.split('|') } : {}),
    },
    known,
    ...(env.WHATSAPP_WABA_ID ? { wabaId: env.WHATSAPP_WABA_ID } : {}),
  })

  console.log(`sent "${name}" in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log(`message id: ${result.messageId}`)
  console.log('\nA test number can only message the recipients you added in the dashboard.')
  process.exit(0)
}

if (mode === '--serve') {
  const port = Number(env.PORT ?? 8792)

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

  const handle = whatsappChannel({
    agent: createAgent({
      index,
      embedder: false,
      store: memoryStore(),
      model: models.fromEnvironment(env as Record<string, string | undefined>),
      persona: { name: 'Ada', business: 'Lumen Coffee Roasters' },
    }),
    appSecret: need('META_APP_SECRET'),
    verifyToken: need('META_VERIFY_TOKEN'),
    phoneNumberId: need('WHATSAPP_PHONE_ID'),
    accessToken: need('WHATSAPP_TOKEN'),
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

    console.log(`${incoming.method} ${incoming.url} -> ${response.status}${text ? ` ${text.slice(0, 60)}` : ''}`)

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    outgoing.writeHead(response.status, headers).end(text)
  }).listen(port, () => {
    console.log(`listening on ${port}\n`)
    console.log('Now, in another terminal:')
    console.log(`  cloudflared tunnel --url http://localhost:${port}`)
    console.log('\nThen in the Meta dashboard, WhatsApp > Configuration > Webhook:')
    console.log(`  callback URL: <the tunnel url>`)
    console.log(`  verify token: ${env.META_VERIFY_TOKEN}`)
    console.log('  subscribe to: messages')
    console.log('\nMeta signs the payload rather than the URL, so a tunnel subdomain that')
    console.log('changes between runs is fine here. You do have to redo the verify step.')
  })
} else if (mode !== '--templates' && mode !== '--send') {
  console.error('usage: live-whatsapp.mts [--templates | --send | --serve]')
  process.exit(1)
}
