---
name: recourse
description: Add a self-hosted customer support agent to a project. Use when someone wants a support bot, a docs chatbot, an AI help desk, or a Chatbase alternative they own. Covers ingesting content, the chat endpoint, the widget, actions, channels, and choosing a store and a model.
---

# recourse

A support agent that learns a site's own content, answers with citations, and
does the things support has to do: capture a lead, look up an order, open a
ticket, hand over to a person.

Nothing here needs an account or an API key to get working.

## The whole setup

```bash
npm install recourse
npx recourse ingest --url https://their-site.com
```

Writes `recourse/knowledge.json`, relative to the working directory. No key
required: the crawler is keyless and the index falls back to keyword-only when
there is no embedding credential.

```ts
// app/api/chat/route.ts
import { createChatHandler } from 'recourse/server'
import { models, embedders } from 'recourse'
import knowledge from '@/recourse/knowledge.json'

export const POST = createChatHandler({
  index: knowledge,
  model: models.fromEnvironment(),
  embedder: embedders.fromEnvironment(),
  persona: { name: 'Ada', business: 'Their Company' },
})
```

The widget file is in the package. Copy it where the site serves static files,
and re-copy it when the package updates:

```bash
cp node_modules/@recourse/widget/dist/recourse.min.js public/recourse.js
```

```html
<script src="/recourse.js" data-endpoint="/api/chat" defer></script>
```

Then always:

```bash
npx recourse doctor
```

It prints a line per check and exits non-zero if anything is actually broken.
A `skip` is not a failure; a `FAIL` names what to fix.

## The environment variables

Nothing is required. With none of these set the agent answers from the index
using keyword search, through the Vercel AI Gateway if it finds a credential.

| Variable | What it does |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Routes the model through the Vercel AI Gateway |
| `RECOURSE_MODEL` | The model id for that path, such as `openai/gpt-4o-mini` |
| `OPENAI_COMPATIBLE_BASE_URL` | Any OpenAI-compatible endpoint, including a local Ollama |
| `OPENAI_COMPATIBLE_API_KEY` | Its key, if it wants one |
| `OPENAI_COMPATIBLE_MODEL` | The chat model on that endpoint |
| `OPENAI_COMPATIBLE_EMBED_MODEL` | The embedding model, for `embedders.fromEnvironment()` |

`embedders.fromEnvironment()` returns nothing when none of these is set, which
leaves keyword-only retrieval rather than an error.

## Where the conversations go

`createChatHandler` keeps nothing by default. Add a store to get transcripts,
leads and the unanswered-question list:

```ts
import { fileStore } from 'recourse/store'

createChatHandler({ index: knowledge, store: fileStore({ dir: '.recourse' }) })
```

```ts
// One machine, or serverless. Anything that scales out needs this instead.
import { postgresStore } from '@recourse/store-postgres'

createChatHandler({ index: knowledge, store: postgresStore({ pool }) })
```

`memoryStore()` is the default and dies with the process. `fileStore` assumes
one writer. `@recourse/store-postgres` and `@recourse/store-d1` are separate
packages and are what a deployment that scales out wants.

## Four mistakes to avoid

These are the ones that cost hours, and none of them announces itself.

**1. Rebuilding the index with a different embedding model.** A query vector
from one model against vectors stored by another is not comparable. There is no
error, the answers just get worse. `recourse doctor` catches it. If the
embedding model changes, re-run `ingest`.

**2. Putting a provider key in the widget.** The widget is a browser bundle.
Models, transcription and every channel credential are server-side. If a
feature seems to need a key in the browser, it needs a route on the server
instead.

**3. Leaving the default store on a deployment that scales.** `memoryStore`
dies with the process and `fileStore` assumes one writer. Every serverless
deployment runs more than one instance under load, and the transcripts,
tickets and sources then scatter across instances that cannot see each other.
Nothing errors. Use `@recourse/store-postgres` for anything real, and create
the store **once at module scope**, one per request exhausts the connection
limit.

**4. Assuming a vision model can call tools.** Most small local models do one
or the other. If attachments need to be answered by a local model, check both.
`attachments: { vision: false }` describes images to a text-only model rather
than having the provider reject the request.

## Choosing

**Model.** `models.fromEnvironment()` prefers a local endpoint when
`OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_MODEL` are both set, and a
gateway id otherwise. The README has a measured comparison; do not guess from
model size, because the smallest model measured is also the most accurate one.

**Store.** `memoryStore` for development, `fileStore` for one instance,
`@recourse/store-postgres` for anything that scales out. All three pass the
same behaviour suite, so swapping is configuration rather than a rewrite.

**Channels.** Ten adapters, each verifying its own webhook signatures. The
agent underneath has no transport at all, so anything that receives a message
can use it directly:

```ts
const { text, sources, unanswered } = await agent.answer('where is my order?')
```

## Things worth turning on

- `actions: [...]`, the difference between a search box that talks and an
  agent. Lead capture, order lookup, escalation, or an HTTP call to their API.
- `procedures: [...]`, ordered steps with branches for refunds and
  cancellations, where the sensitive actions are unreachable anywhere else.
- `attachments: { maxBytes }`, photos and PDFs. Off unless set. Inline base64
  is right up to a screenshot; past that add `storage: { blobs, secret }` and
  `uploadRoute`, since a large file has to fit in one request body otherwise.
  Never accept a bare `key` from a browser: the upload route issues a `token`
  beside it and the chat handler checks it.
- `dictation: true` on the widget, a mic, on-device by default.
- `classifier`, on by default. Instruction-override attempts and threats are
  refused before the model is called; a message that sounds like a crisis goes
  to a person.

## Where to look

- `README.md` for the measured tables: models, retrieval thresholds, eval
  scores. Do not restate those numbers from memory; they were measured and
  they change.
- `packages/evals` for whether a change made answers better or worse.
  `pnpm eval --suite retrieval` needs no model and runs in a second.
- `recourse doctor` before declaring anything finished.
