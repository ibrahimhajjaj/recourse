# recourse

A customer support agent that learns your own content, answers with citations,
and does the things a support agent has to do: capture a lead, look up an order,
open a ticket, hand over to a person.

Not a chat box on a website. The same agent answers on WhatsApp, Slack,
Telegram, Discord, Messenger, Microsoft Teams, SMS and email, inside Intercom's
own messenger, and through Zendesk's Sunshine, which brings LINE, WeChat and
Viber with it. It answers the phone. It will talk to somebody in their browser
and let them interrupt. When a person should take the thread it goes to whichever
of nine desks you already run, with a summary, the customer's mood, and what the
agent already tried.

Three things separate it from the hosted tools. You write the procedures it
follows, step by step, so it does what your business actually does rather than
what somebody else's settings page allows. Whoever spots a wrong answer writes
what it should have said, and that applies to the next message, with no deploy,
no rebuild and no engineer. And there is a second complete implementation in
PHP, so a WordPress site with no build step installs a plugin and gets the same
answers, held to the Node version by tests that compare the two line for line.

Self-hosted and MIT. There is nothing to sign up for to get it working.

## It runs before you configure anything

No account, no API key, no model, no database. Point it at some content and ask
it something:

```bash
npx @recourse-ai/core@latest init
```

It looks at what you have, learns the content you point it at, installs itself,
writes the chat endpoint for your framework and hands you the widget snippet.
It also asks how it should answer, and one of the choices is a model already
running on your machine, which needs no account and no key. Pick "decide later"
and the widget cites the passages it found and hands over to a person until you
set one. Or do the two steps by hand:

```bash
npx @recourse-ai/core ingest --path ./docs
npx @recourse-ai/core ask "how do I get a refund?"
```

```
Indexed 1 documents into 2 chunks in 0.0s
Retrieval: keyword only
Written to recourse/knowledge.json (1 KB)

No AI_GATEWAY_API_KEY set, showing retrieved passages instead of an answer.

[1] Refunds  (keyword, 0.0164)
We refund any order within 30 days of delivery.
```

That is the real output, with nothing configured. Retrieval is the part that
has to be right, and it runs locally on your machine with no credential at all.
Everything above it is optional and each piece is one environment variable:

| Layer | Needs | What it adds |
| --- | --- | --- |
| Keyword retrieval | nothing | finds the passage that answers the question |
| Vectors | an embedding endpoint | matches a question phrased differently |
| Written answers | any OpenAI-compatible model | turns the passages into a sentence |

Nothing degrades to an error. Without an embedder the index is keyword-only and
says so; without a model `ask` shows you the passages it found and says why.

`createAgent({ index })` does the same: with no model configured and no
`AI_GATEWAY_API_KEY`, it answers with the passages and a line saying what is
missing, rather than making a request that cannot succeed.

```bash
npx @recourse-ai/core ingest --url https://your-site.com
```

## Nothing to sign up for

Two changes in 2026 mean you can get the whole thing working without creating an
account anywhere.

**Reading your website is free.** `ingest --url` fetches your pages through
Firecrawl, a service that turns a web page into clean text. In June 2026 they
stopped asking for an account, so the command just works, for 1,000 pages a
month. Past that it asks you for a key.

**Answering is free on Vercel.** Model calls go through Vercel's AI Gateway,
which forwards them to a provider. When your code is running on a Vercel
deployment, Vercel hands it a signed token proving the request really is from
your deployment, so there is no key for you to make. Deploy it and it answers.

Neither is a lock-in. Point it at any OpenAI-compatible endpoint instead,
including Ollama on your own machine. This repository was built and tested against a local
`qwen3:4b` with `nomic-embed-text` embeddings, on a laptop, with no cloud
account involved at any point.

## 60 seconds

```bash
npm install @recourse-ai/core ai
npx @recourse-ai/core ingest --url https://your-site.com
```

```ts
// app/api/chat/route.ts
import { createChatHandler } from '@recourse-ai/core/server'
import knowledge from '../../../recourse/knowledge.json'

const handler = createChatHandler({ index: knowledge })
export const POST = handler
export const OPTIONS = handler
```

```html
<script
  src="https://cdn.jsdelivr.net/npm/@recourse-ai/widget/dist/recourse.min.js"
  data-endpoint="/api/chat"
  data-title="Ask us anything"
></script>
```

No database to provision, no vector store to configure, no background job.

## Running the example

```bash
pnpm install
pnpm --filter recourse-example-nextjs ingest
pnpm example
```

A fictional coffee shop whose help pages are real markdown, with a refund
procedure, a procedure-only order lookup, a client action reading the basket out
of the page, lead capture, escalation into the help desk, and the admin page at
`/api/admin/admin`.

## Setting it up with a coding agent

```bash
npx skills add ibrahimhajjaj/recourse
```

Installs a `SKILL.md` into whichever coding agent you use: Claude Code, Codex,
Cursor, Antigravity, Zed and about seventy others. The agent then knows the
setup path and, more usefully, the four mistakes that cost hours and announce
themselves in no way at all: rebuilding the index with a different embedding
model, putting a provider key in the browser bundle, leaving the in-memory
store on a deployment that scales, and assuming a vision model can call tools.

## The pieces

**Answers from your content.** Crawl a site, read a folder, write question and
answer pairs, import Notion. A folder is read as more than markdown: PDFs, Word
files, slide decks, spreadsheets and the OpenDocument and EPUB formats all
convert, because a price list is usually a spreadsheet and an onboarding pack is
usually a deck. Retrieval is keyword ranking and vector search fused, and it
degrades to keyword-only when you have no embedding credential.

**Fixable by the person who spots the mistake.** When it answers something
wrong, whoever noticed writes what it should have said and that applies to the
next message. No rebuild, no deploy, no engineer.

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
Instagram, Slack, Telegram, Discord, Microsoft Teams, SMS and email, each
checking the platform's own signature. Inside Intercom's messenger too, so the
thread stays where your team already works. And through Zendesk's Sunshine,
which brings LINE, WeChat and Viber with it. Discord is a slash command rather
than free chat, because a Discord interactions webhook never sees ordinary
typing.

**Hands over to the desk you already run.** Zendesk, Freshdesk, Intercom, Help
Scout, Zoho Desk, HubSpot, Gorgias, Salesforce, Odoo. Whoever picks it up gets
the last twenty messages and what the agent already tried and whether any of it
worked, plus a summary and the customer's mood once the conversation insights
are wired up, which is a scheduler you supply and
[docs/stores.md](docs/stores.md) shows.

**Answers the phone.** Twilio carries the call, through Conversation Relay or a
plain call-and-response loop. Or ElevenLabs carries it, owning the number and
the turn-taking while this answers the questions their agent asks mid-sentence,
fenced by a system prompt written from here. Or nobody carries it and the call
happens in the browser with no phone in it. The ElevenLabs path has taken a real
call. The Twilio pair are built to their API and tested against recorded shapes,
and nobody has pointed a live number at them yet.

**Plugs into your editor.** The management API also speaks Model Context
Protocol, so Claude Desktop, Cursor or anything else that speaks it can read
your support data as tools. Ask "what are people asking that we cannot answer?"
and get the gap list; ask what the customer on ticket 412 actually said without
leaving the editor. Read-only on purpose, one endpoint, no process to run.

**Takes a call from the page itself.** A Call button in the widget, with no
phone number and no telephony account. Either a voice vendor carries it, or
your own server does over a plain WebSocket, in which case the same agent that
answers the chat answers the call and the persona, the classifier and the
procedures all still apply. The caller can interrupt it, and it answers in
whatever language they speak.

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
| Let someone talk to it from the page | [docs/calls.md](docs/calls.md) |
| Point a real phone number at it | [docs/twilio.md](docs/twilio.md) |
| Open tickets, route them, respect working hours | [docs/helpdesk.md](docs/helpdesk.md) |
| See how long customers wait, and whether the backlog is growing | [docs/helpdesk.md](docs/helpdesk.md#what-the-queue-looks-like) |
| Hand off to Zendesk, Intercom or another desk | [docs/escalation.md](docs/escalation.md) |
| Answer someone who did not write in English | [docs/languages.md](docs/languages.md) |
| Keep it inside its limits | [docs/safety.md](docs/safety.md) |
| Keep keys out of the browser and rate limit it | [docs/security.md](docs/security.md) |
| Cap what it spends, and stop paying to re-embed | [docs/costs.md](docs/costs.md) |
| Store conversations somewhere that survives | [docs/stores.md](docs/stores.md) |
| Start conversations, and tell other systems | [docs/reaching-out.md](docs/reaching-out.md) |
| Wire it to Zapier, ViaSocket, Make or n8n | [docs/automation.md](docs/automation.md) |
| Read your tickets from Claude Desktop or your editor | [docs/automation.md](docs/automation.md#reading-it-from-inside-a-coding-agent) |
| Let a non-developer fix a wrong answer | [docs/corrections.md](docs/corrections.md) |
| Let a non-developer change the configuration | [docs/config-assistant.md](docs/config-assistant.md) |
| Change how it sounds, or write a tone of your own | [tones/README.md](tones/README.md) |
| Change what it does without forking it | [docs/hooks.md](docs/hooks.md) |
| Serve a help centre people can search | [docs/retrieval.md](docs/retrieval.md#the-same-index-as-a-page-people-can-search) |
| Find out whether any of it actually works | [docs/evals.md](docs/evals.md) |
| Put it on Cloudflare, and check it before a customer does | [docs/deploying.md](docs/deploying.md) |
| Accept a PDF or a photo of a broken part | [docs/files.md](docs/files.md) |
| Run it on WordPress, with no build step at all | [docs/wordpress.md](docs/wordpress.md) |
| Use it from a tool that already speaks OpenAI | [docs/openai-endpoint.md](docs/openai-endpoint.md) |
| See how conversations actually ended, not just how many | [docs/automation.md](docs/automation.md) |
| Embed the chat window | [packages/widget/README.md](packages/widget/README.md) |

Two more worth knowing about. Every credential each channel needs, and the step
each platform's own documentation leaves out, is in
[`examples/nextjs/.env.example`](examples/nextjs/.env.example). What has been
proved against a live platform and what has not is in
[`CHANNELS-VERIFIED.md`](CHANNELS-VERIFIED.md), kept separate so the difference
is never blurred into a claim.

Upgrading from an earlier version: [`CHANGELOG.md`](CHANGELOG.md) leads with the
things an existing deployment has to change, and says what to do about each.

## Where a hosted product wins

It does not host anything for you, and it has no dashboard beyond that one read
only page. Multi-agent management has no equivalent: in a hosted product an
account holds many agents, so they need an API to create them, while here the
deployment is the agent and its configuration is code in your repository.

It also does not scale indefinitely on a JSON file. Past roughly 20,000 chunks
you want a real vector store. The `VectorStore` boundary is where that goes, the
in-file scan is its default, and `@recourse-ai/store-postgres` puts the vectors
in Postgres through pgvector when the file stops being the right answer.

## Contributing

Bug reports and fixes are welcome. Anything larger starts as a discussion
rather than a pull request, so that whether it belongs gets settled before
anybody spends an evening on it. [CONTRIBUTING.md](CONTRIBUTING.md) has the
detail, including the two ports of the tokeniser that have to stay in step and
why linting a fresh checkout before building it looks broken.

## Licence

MIT, for the library, the widget and the store adapters. Self-host it, change
it, run it commercially, no conditions beyond keeping the notice.

The WordPress plugin in `packages/wordpress` is a separate work under
GPL-2.0-or-later, which is what the wordpress.org directory requires. It talks
to the rest over HTTP rather than bundling it, so the two licences never meet
in one binary. MIT is GPL-compatible, so a site running both is fine.

The name is not part of the licence. MIT covers the code and nothing else, so
"Recourse" and its logo stay with the author. Fork it, sell it, build a business
on it, all of that is granted. What is not granted is calling your version
Recourse, or naming a service after it in a way that suggests it comes from
here. Say it is built on Recourse and you are welcome.

That distinction is the whole reason it is written down: under a permissive
licence the name is the only thing an author still holds, and a reader deserves
to know which parts they are free to take.
