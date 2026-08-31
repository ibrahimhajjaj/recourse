# recourse

A customer support agent that learns your own website and answers from it, with
citations. No API keys to create, no database, no vendor.

```bash
npx @recourse-ai/core ingest --url https://your-site.com
```

```ts
import { createChatHandler } from '@recourse-ai/core/server'
import knowledge from './recourse/knowledge.json'

export const POST = createChatHandler({ index: knowledge })
```

Full documentation: https://github.com/ibrahimhajjaj/recourse

Each topic has its own page rather than one long file: [choosing a
model](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/models.md),
[getting your content
in](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/retrieval.md),
[actions](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/actions.md),
[channels](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/channels.md),
[the help
desk](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/helpdesk.md),
[security](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/security.md),
[stores](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/stores.md),
[evals](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/evals.md),
[deploying](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/deploying.md),
[files](https://github.com/ibrahimhajjaj/recourse/blob/main/docs/files.md).

## Exports

| Entry | What it gives you |
| --- | --- |
| `@recourse-ai/core` | Everything below, re-exported |
| `@recourse-ai/core/server` | `createChatHandler`, a `Request` to `Response` function |
| `@recourse-ai/core/agent` | `createAgent`, the agent with no transport attached |
| `@recourse-ai/core/actions` | Lead capture, escalation, HTTP actions, commerce, handoff |
| `@recourse-ai/core/procedures` | Multi-step flows with branches and variables |
| `@recourse-ai/core/channels` | WhatsApp, Messenger, Instagram, Slack, Teams, Telegram, Discord, SMS, voice, email, Sunshine |
| `@recourse-ai/core/helpdesk` | Tickets, routing, assignment, triggers, saved views, and connectors for nine outside desks |
| `@recourse-ai/core/api` | Management API, admin page, public help page |
| `@recourse-ai/core/store` | Conversation, lead, ticket and source persistence |
| `@recourse-ai/core/store/conformance` | The suite every store has to pass, for one you write yourself |
| `recourse/store/conformance` | The suite a store of your own has to pass |
| `@recourse-ai/core/webhooks` | Signed outbound events |
| `@recourse-ai/core/outbound` | Campaigns, with consent enforced |
| `@recourse-ai/core/tool` | `knowledgeTool`, for the AI SDK, eve, or anything built on them |
| `@recourse-ai/core/ingest` | `ingest` and `writeIndex`, for build scripts |
| `@recourse-ai/core/attachments` | Validating and reading files a visitor sends |
| `@recourse-ai/core/safety` | Classifier with per-category sensitivity and actions |
| `@recourse-ai/core/models` | `models` and `embedders`, including one picked from the environment |
| `@recourse-ai/core/storage` | S3, R2 and local blobs for what a visitor uploads |

## CLI

```
recourse ingest --url <site>     Learn a website
recourse ingest --path <dir>     Learn a folder of markdown
recourse ask "<question>"        Ask the index from the terminal
recourse stats                   Show what is in the index
```

MIT
