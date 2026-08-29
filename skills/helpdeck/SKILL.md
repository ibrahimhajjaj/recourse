---
name: helpdeck
description: Add a self-hosted customer support agent to a project. Use when someone wants a support bot, a docs chatbot, an AI help desk, or a Chatbase alternative they own. Covers ingesting content, the chat endpoint, the widget, actions, channels, and choosing a store and a model.
---

# helpdeck

A support agent that learns a site's own content, answers with citations, and
does the things support has to do: capture a lead, look up an order, open a
ticket, hand over to a person.

Nothing here needs an account or an API key to get working.

## The whole setup

```bash
npx helpdeck ingest --url https://their-site.com
```

Writes `helpdeck/knowledge.json`. No key required: the crawler is keyless and
the index falls back to keyword-only when there is no embedding credential.

```ts
// app/api/chat/route.ts
import { createChatHandler } from 'helpdeck/server'
import { models, embedders } from 'helpdeck'
import knowledge from '@/helpdeck/knowledge.json'

export const POST = createChatHandler({
  index: knowledge,
  model: models.fromEnvironment(),
  embedder: embedders.fromEnvironment(),
  persona: { name: 'Ada', business: 'Their Company' },
})
```

```html
<script src="/helpdeck.js" data-endpoint="/api/chat" defer></script>
```

Then always:

```bash
npx helpdeck doctor
```

## Four mistakes to avoid

These are the ones that cost hours, and none of them announces itself.

**1. Rebuilding the index with a different embedding model.** A query vector
from one model against vectors stored by another is not comparable. There is no
error, the answers just get worse. `helpdeck doctor` catches it. If the
embedding model changes, re-run `ingest`.

**2. Putting a provider key in the widget.** The widget is a browser bundle.
Models, transcription and every channel credential are server-side. If a
feature seems to need a key in the browser, it needs a route on the server
instead.

**3. Leaving the default store on a deployment that scales.** `memoryStore`
dies with the process and `fileStore` assumes one writer. Every serverless
deployment runs more than one instance under load, and the transcripts,
tickets and sources then scatter across instances that cannot see each other.
Nothing errors. Use `@helpdeck/store-postgres` for anything real, and create
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
`@helpdeck/store-postgres` for anything that scales out. All three pass the
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
- `helpdeck doctor` before declaring anything finished.
