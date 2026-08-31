# helpdeck

A customer support agent that learns your own content, answers with citations,
and does the things a support agent has to do: capture a lead, look up an order,
open a ticket, hand over to a person.

It is the self-hosted shape of what Chatbase sells, with two differences: you own
the code, and there is nothing to sign up for to get it working.

```bash
npx helpdeck ingest --url https://your-site.com
```

That command needs no account and no API key.

## No keys to create

Two things landed in 2026 that removed the usual signup wall:

- **Firecrawl went keyless** in June 2026. `/scrape` and `/search` answer with no
  `Authorization` header at all, and every caller gets 1,000 pages a month.
- **Vercel's AI Gateway authenticates deployments over OIDC**, so a deployment
  gets a token injected with no key to create.

You can replace the second with any OpenAI-compatible endpoint, including Ollama
on your own machine. This repository was built and tested against a local
`qwen3:4b` with `nomic-embed-text` embeddings, on a laptop, with no cloud
account involved at any point.

## 60 seconds

```bash
npm install helpdeck
npx helpdeck ingest --url https://your-site.com
```

```ts
// app/api/chat/route.ts
import { createChatHandler } from 'helpdeck/server'
import knowledge from '../../../helpdeck/knowledge.json'

const handler = createChatHandler({ index: knowledge })
export const POST = handler
export const OPTIONS = handler
```

```html
<script
  src="https://cdn.jsdelivr.net/npm/@helpdeck/widget/dist/helpdeck.min.js"
  data-endpoint="/api/chat"
  data-title="Ask us anything"
></script>
```

No database to provision, no vector store to configure, no background job.

## Running the example

```bash
pnpm install
pnpm --filter helpdeck-example-nextjs ingest
pnpm example
```

A fictional coffee shop whose help pages are real markdown, with a refund
procedure, a procedure-only order lookup, a client action reading the basket out
of the page, lead capture, escalation into the help desk, and the admin page at
`/api/admin/admin`.

## Setting it up with a coding agent

```bash
npx skills add ibrahimhajjaj/helpdeck
```

Installs a `SKILL.md` into whichever coding agent you use: Claude Code, Codex,
Cursor, Antigravity, Zed and about seventy others. The agent then knows the
setup path and, more usefully, the four mistakes that cost hours and announce
themselves in no way at all: rebuilding the index with a different embedding
model, putting a provider key in the browser bundle, leaving the in-memory
store on a deployment that scales, and assuming a vision model can call tools.

## The pieces

**Answers from your content.** Crawl a site, read a folder, write question and
answer pairs, import Notion, upload a PDF. Retrieval is BM25 and vector search
fused, and it degrades to keyword-only when you have no embedding credential.

**Acts, rather than only replying.** Capture a lead, collect custom fields, call
your API, search the web, look up a Stripe subscription or a Shopify order, show
a button or a form, run something in the visitor's own browser, escalate to a
person.

**Follows procedures on the flows that matter.** A refund or a cancellation gets
an ordered set of steps with branches, and the sensitive actions inside it are
unreachable anywhere else.

**Runs a help desk.** Tickets with statuses, teams, routing rules, assignment,
threads, triggers, saved views, and AI-drafted replies a person approves before
they send.

**Reaches customers where they are.** Web widget, WhatsApp, Messenger,
Instagram, Slack, Telegram, Discord, Microsoft Teams, SMS and email, all with
real webhook signature verification.

**Answers the phone.** Inbound calls over Twilio, with four ways to run the
turn: ConversationRelay, plain TwiML `<Gather>`, your own speech provider, or
ElevenLabs driving the whole conversation.

**Reads what the customer sends.** Photos of a damaged item go to the model as
image parts; PDFs, Word files and text are extracted server-side, so documents
work with any model and not only a vision one.

**Refuses what it should, and escalates what it must.** Instruction-override
attempts and threats are declined without ever reaching the model, and a
message that sounds like a crisis goes to a person rather than a refusal.

**Tells you what it could not answer.** Every unanswered question is recorded and
ranked, which is the list of content worth writing next.

**Tells you where it was guessing.** Every answer is checked against the
passages it was given, and a figure that appears in none of them is recorded on
the transcript. The most expensive thing a support agent can invent is a
number, because a customer acts on it.

## The rest of it

Each of these is one job, in its own file, so nothing has to be read that is not
the thing you came for.

| You want to | Read |
| --- | --- |
| Pick a model, or run one on your own machine | [docs/models.md](docs/models.md) |
| Get your content in, and keep the index small | [docs/retrieval.md](docs/retrieval.md) |
| Let it look things up and change things | [docs/actions.md](docs/actions.md) |
| Answer on WhatsApp, Slack, email, the phone | [docs/channels.md](docs/channels.md) |
| Open tickets, route them, respect working hours | [docs/helpdesk.md](docs/helpdesk.md) |
| Hand off to Zendesk, Intercom or another desk | [docs/escalation.md](docs/escalation.md) |
| Answer someone who did not write in English | [docs/languages.md](docs/languages.md) |
| Keep it inside its limits | [docs/safety.md](docs/safety.md) |
| Keep keys out of the browser and rate limit it | [docs/security.md](docs/security.md) |
| Store conversations somewhere that survives | [docs/stores.md](docs/stores.md) |
| Start conversations, and tell other systems | [docs/reaching-out.md](docs/reaching-out.md) |
| Wire it to Zapier, ViaSocket, Make or n8n | [docs/automation.md](docs/automation.md) |
| Let a non-developer fix a wrong answer | [docs/config-assistant.md](docs/config-assistant.md) |
| Find out whether any of it actually works | [docs/evals.md](docs/evals.md) |
| Put it on Cloudflare, and check it before a customer does | [docs/deploying.md](docs/deploying.md) |
| Accept a PDF or a photo of a broken part | [docs/files.md](docs/files.md) |
| Run it on WordPress, with no build step at all | [docs/wordpress.md](docs/wordpress.md) |
| Embed the chat window | [packages/widget/README.md](packages/widget/README.md) |

Two more worth knowing about. Every credential each channel needs, and the step
each platform's own documentation leaves out, is in
[`examples/nextjs/.env.example`](examples/nextjs/.env.example). What has been
proved against a live platform and what has not is in
[`CHANNELS-VERIFIED.md`](CHANNELS-VERIFIED.md), kept separate so the difference
is never blurred into a claim.

## Where a hosted product wins

It does not host anything for you, and it has no dashboard beyond that one read
only page. Multi-agent management has no equivalent: in a hosted product an
account holds many agents, so they need an API to create them, while here the
deployment is the agent and its configuration is code in your repository.

It also does not scale indefinitely on a JSON file. Past roughly 20,000 chunks
you want a real vector store. The `VectorStore` boundary is where that goes and
it exists now, with the in-file scan as its default implementation; what does
not exist yet is a database behind it.

## Licence

MIT
