# helpdeck

A customer support agent that learns your own website and answers from it, with
citations. No API keys to create, no database, no vendor.

```bash
npx helpdeck ingest --url https://your-site.com
```

```ts
import { createChatHandler } from 'helpdeck/server'
import knowledge from './helpdeck/knowledge.json'

export const POST = createChatHandler({ index: knowledge })
```

Full documentation: https://github.com/ibrahimhajjaj/helpdeck

## Exports

| Entry | What it gives you |
| --- | --- |
| `helpdeck` | Everything below, re-exported |
| `helpdeck/server` | `createChatHandler`, a `Request` to `Response` function |
| `helpdeck/agent` | `createAgent`, the agent with no transport attached |
| `helpdeck/actions` | Lead capture, escalation, HTTP actions, commerce, handoff |
| `helpdeck/procedures` | Multi-step flows with branches and variables |
| `helpdeck/channels` | WhatsApp, Slack, Teams, Telegram, Discord, SMS, email |
| `helpdeck/helpdesk` | Tickets, routing, assignment, triggers, saved views |
| `helpdeck/api` | Management API, admin page, public help page |
| `helpdeck/store` | Conversation, lead, ticket and source persistence |
| `helpdeck/webhooks` | Signed outbound events |
| `helpdeck/outbound` | Campaigns, with consent enforced |
| `helpdeck/tool` | `knowledgeTool` for AI SDK and eve agents |
| `helpdeck/ingest` | `ingest` and `writeIndex`, for build scripts |
| `helpdeck/attachments` | Validating and reading files a visitor sends |

## CLI

```
helpdeck ingest --url <site>     Learn a website
helpdeck ingest --path <dir>     Learn a folder of markdown
helpdeck ask "<question>"        Ask the index from the terminal
helpdeck stats                   Show what is in the index
```

MIT
