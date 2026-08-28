# helpdeck

A customer support agent that learns your own website and answers from it, with
citations. Install it, point it at your site, put one script tag on the page.

It is the self-hosted shape of what Chatbase sells, with two differences: you
own the code, and there is nothing to sign up for to get it working.

```bash
npx helpdeck ingest --url https://your-site.com
```

That command needs no account and no API key. It reads your site through
Firecrawl's keyless tier, which gives every caller 1,000 pages a month, and
writes a single `knowledge.json` you commit alongside your code.

## Why there are no keys to create

Two things landed in 2026 that removed the usual signup wall:

- **Firecrawl went keyless** in June 2026. `/scrape` and `/search` answer with
  no `Authorization` header at all. Ingest costs you nothing.
- **Vercel's AI Gateway authenticates deployments over OIDC.** A Vercel
  deployment gets a token injected automatically, so the answering side needs no
  key either.

You still need a Vercel account for the second one, and you can replace it with
any OpenAI-compatible endpoint, including Ollama on your own machine. What you
do not need is a stack of provider signups before you see it work.

## 60 seconds

```bash
npm install helpdeck
npx helpdeck ingest --url https://your-site.com
```

One route, in a Next.js app:

```ts
// app/api/chat/route.ts
import { createChatHandler } from 'helpdeck/server'
import knowledge from '../../../helpdeck/knowledge.json'

const handler = createChatHandler({ index: knowledge })

export const POST = handler
export const OPTIONS = handler
```

One tag, on any page:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@helpdeck/widget/dist/helpdeck.min.js"
  data-endpoint="/api/chat"
  data-title="Ask us anything"
></script>
```

That is the whole integration. There is no database to provision, no vector
store to configure, and no background job to keep the index warm.

## How it works

Three pieces, and you can replace any of them without touching the other two.

**Ingest** reads a site or a folder, splits it on heading boundaries, and builds
a keyword index plus optional embeddings. It runs once, at build time, and its
output is a JSON file.

**Retrieve** runs BM25 and, when the index has vectors, cosine search, then
fuses the two rankings. It works on a plain in-memory array because a few
thousand chunks scan in under a millisecond, so a cold start is a JSON parse
rather than a database connection.

**Answer** hands the retrieved passages to a model with instructions that fence
it to those passages and give it an explicit way to say it does not know. The
response streams back as server-sent events, and the sources go out before the
first token so the widget can show citations while the answer is still arriving.

## Retrieval, and what it costs you to skip embeddings

An index built with no credentials is keyword-only. That is genuinely good at
the things support questions are mostly made of: product names, error codes,
SKUs, plan names, the exact words on your pricing page.

It has one real blind spot. A customer who writes "can I get my money back"
shares no word with a page that says "refund", so keyword search cannot connect
them. There is a test in this repo that asserts exactly that, because it is a
limit worth being honest about rather than papering over.

Adding embeddings fixes it:

```bash
AI_GATEWAY_API_KEY=... npx helpdeck ingest --url https://your-site.com --embed
```

Vectors are stored as int8 rather than float32. A 512-dimension vector is 12KB
of JSON as floats and about 700 bytes quantised, which is the difference between
an index you commit to git and one that needs a database.

## Integrating it

### Any JavaScript server

`createChatHandler` returns a `(Request) => Promise<Response>` function, which
is the one interface every modern runtime agrees on.

```ts
import { createChatHandler } from 'helpdeck/server'

const handler = createChatHandler({ index: knowledge })

// Hono
app.post('/api/chat', (c) => handler(c.req.raw))

// Cloudflare Workers, Bun, Deno
export default { fetch: handler }
```

### Anywhere a message arrives

The widget and the HTTP handler are conveniences. The agent underneath has no
transport at all, so it drops into whatever already receives your customers'
messages:

```ts
import { createAgent } from 'helpdeck/agent'
import knowledge from './helpdeck/knowledge.json'

const agent = createAgent({ index: knowledge, persona: { business: 'Acme' } })

const { text, sources, unanswered } = await agent.answer('where is my order?')
```

That is the whole integration for a channel. A WhatsApp webhook replies with
`text`. An email worker puts `text` in the body and `sources` in the footer.
A Slack bot posts it to the thread. A Zendesk or Intercom automation drafts it
for an agent to approve.

```ts
// WhatsApp, or any inbound webhook
app.post('/webhook', async (req) => {
  const { text } = await agent.answer(req.body.message, historyFor(req.body.from))
  await whatsapp.send(req.body.from, text)
})

// Inbound email
export async function onEmail(mail) {
  const { text, sources, unanswered } = await agent.answer(mail.subject + '\n' + mail.body)
  // Hand anything it could not answer to a person instead of guessing.
  if (unanswered) return escalate(mail)
  await reply(mail, text, sources)
}
```

`answer()` waits for the whole reply, which is what a queue or a webhook wants.
`stream()` yields the same content as frames, for anywhere a person is watching
the reply appear. `search()` gives you the passages and no model call at all.

### Inside an agent you already have

If you have an agent with its own loop, it does not want an endpoint, it wants
somewhere to look things up. `knowledgeTool` returns an AI SDK tool:

```ts
import { knowledgeTool } from 'helpdeck/tool'
import { streamText } from 'ai'

const result = streamText({
  model: 'openai/gpt-4o-mini',
  instructions: 'Answer only from the help documentation.',
  messages,
  tools: { searchHelp: knowledgeTool({ index: knowledge }) },
})
```

The same shape works as a tool file in [eve](https://github.com/vercel/eve),
whose tools take the same `description` / `inputSchema` / `execute` contract.
Drop it in `agent/tools/search_help.ts` and an eve agent gains this retrieval
alongside its Slack, Discord, Teams, Telegram and Twilio channels.

helpdeck is deliberately not built on eve. eve is a durable agent runtime: it
needs Node 24, a Workflow world backing run state on persistent storage, and a
sandbox backend. Answering a support question is one retrieval and one
completion with no state to keep, so paying for that machinery would cost the
Cloudflare Workers, Deno, Bun and Node 20 hosts helpdeck runs on today. Being a
tool eve can call gets the benefit without the coupling.

For an agent that is not built on the AI SDK, `createKnowledgeSearch` is the
same lookup as a plain async function returning numbered passages.

### Bring your own model

`model` takes a Gateway model id or any provider instance:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

createChatHandler({
  index: knowledge,
  // Ollama on your own hardware, or OpenRouter, Groq, Together, anything.
  model: createOpenAICompatible({
    name: 'ollama',
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama',
  })('llama3.2'),
})
```

## Configuration

```ts
createChatHandler({
  index: knowledge,
  model: 'openai/gpt-4o-mini',

  persona: {
    name: 'Nadia',
    business: 'Lumen Coffee Roasters',
    instructions: 'Ask for an order number rather than guessing.',
    fallback: "I can't find that. Email hello@example.com and a human will reply.",
  },

  topK: 6,
  cors: { allowedOrigins: ['https://your-site.com'] },
  rateLimit: { limit: 20, windowMs: 60_000 },

  // Every unanswered question is a gap in your documentation.
  onConversation({ question, answer, unanswered }) {
    if (unanswered) analytics.track('support_gap', { question })
  },
})
```

Widget options are data attributes on the script tag: `data-title`,
`data-subtitle`, `data-greeting`, `data-accent`, `data-position`, `data-theme`,
`data-suggestions` (pipe separated), `data-target` (a selector, to render inline
rather than floating). `window.helpdeck` exposes `open`, `close`, `ask`, `clear`
and `destroy`.

## The widget

15KB minified, no dependencies, rendered into a closed-off shadow root so the
host page's CSS cannot reach it and its own styles cannot leak out. It follows
the visitor's light or dark preference, restores the conversation for the tab's
lifetime, and ships the ARIA roles a screen reader needs.

Model output is rendered by building DOM nodes, never by assigning `innerHTML`.
That is a security boundary rather than a style preference: the text being
rendered came from a model that read the visitor's own message, so any HTML path
would be a cross-site scripting hole on every site that embeds the widget. The
test suite fires script tags, `onerror` attributes, iframes and `javascript:`
links at it.

Citations shown under an answer are the ones the model actually cited, parsed
from its `[1]` markers, not everything retrieval happened to return.

## Running the example

```bash
pnpm install
pnpm --filter helpdeck-example-nextjs ingest
pnpm example
```

A fictional coffee shop whose help pages are real markdown, with the agent
wired up the way you would wire your own. Ask it about delivery, refunds or
grind size, then ask it something it cannot know and watch it decline.

## What this is not

It does not do ticketing, inbox routing, human takeover, or outbound campaigns.
It answers questions from your content and tells you when it cannot. If you need
a help desk, this is the retrieval and answering half of one.

It also does not scale indefinitely on a JSON file. Past roughly 20,000 chunks
you want a real vector store, and the `Store` boundary in the types is where
that goes.

## Licence

MIT
