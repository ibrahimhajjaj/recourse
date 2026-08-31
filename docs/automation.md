# Wiring it to everything else

Zapier, ViaSocket, Make and n8n all do the same job: they wait for something to
happen and then do something elsewhere. What they need from this library is a
way to hear about events and a way to ask it questions, and both already exist.

## Telling them when something happens

Every one of these platforms gives you a URL to post to. Paste it in:

```ts
import { createWebhooks } from 'helpdeck'

const webhooks = createWebhooks({
  endpoints: [
    { url: 'https://hooks.zapier.com/hooks/catch/123/abcdef', events: ['lead.captured'] },
    { url: 'https://flow.viasocket.com/hook/xyz' },
  ],
  secret: process.env.HELPDECK_WEBHOOK_SECRET,
})
```

Six events are sent: `conversation.answered`, `conversation.unanswered`,
`lead.captured`, `ticket.opened`, `ticket.updated` and `message.feedback`. An
endpoint with no `events` gets all of them.

Each delivery is a flat JSON object with `id`, `event`, `createdAt` and `data`,
which is the shape these platforms expect to be handed. The `X-Helpdeck-Event`
header carries the name for routing, and `X-Helpdeck-Delivery` is stable across
retries so a receiver can drop a repeat.

## When the URL is not known at deploy time

Somebody building a Zap will hand you a URL you did not have when you shipped.
Rather than redeploying, read them from wherever you keep them:

```ts
createWebhooks({
  endpoints: () => db.webhookEndpoints.findMany(),
})
```

The function is called per event. A lookup that fails is reported through
`onError` and dropped, because an answer to a customer is never held up by a
webhook, and never failed by one either.

## Letting them ask questions

The management API is REST with bearer auth, so the generic HTTP action every
one of these platforms ships can call it directly. `GET /conversations`,
`GET /leads`, `GET /stats`, the whole ticket queue. That also makes a polling
trigger possible without any of the above: point one at `/conversations` and
let it poll.

## Reading it from inside a coding agent

The same data, as tools a model can call. Turn it on and the management API
also speaks Model Context Protocol at `POST /mcp`:

```ts
import { createApiHandler } from 'helpdeck/api'

createApiHandler({ store, helpdesk, tokens: [process.env.HELPDECK_TOKEN!], mcp: { agent } })
```

Then point a client at it. In Claude Desktop or an editor that speaks MCP:

```json
{
  "mcpServers": {
    "helpdeck": {
      "url": "https://support.example.com/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

A support lead can then ask "what are people asking that we cannot answer?" and
get the gap list, and an engineer can ask what the customer on ticket 412
actually said without leaving the editor. The tools are `list_answer_gaps`,
`support_stats`, `list_conversations`, `get_conversation`, plus
`search_knowledge` when you pass the agent and `list_tickets`, `get_ticket` and
`search_tickets` when you pass a help desk.

Two things worth knowing. It is **read-only**, on purpose: every tool answers a
question and none of them change anything, because an agent that closes a
customer's ticket over a misread sentence is a worse trade than opening the
dashboard. And it is behind the same `tokens` and the same `onAccess` log as
every other route, so there is one credential to rotate and one audit trail to
read rather than two.

There is no process to run and no transport to configure. It is JSON-RPC 2.0
over ordinary HTTP on the endpoint you already serve, which also means it works
unchanged on Cloudflare Workers.

## Deliberately not here

There is no published Zapier app. Publishing one means an account, a review and
a listing, and it would point at a single hosted deployment, which is the one
thing a self-hosted library does not have. What is here is everything such an
app would be built on, so if you want to publish one for your own deployment,
nothing is in your way.

---

[Back to the README](../README.md)
