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

## Deliberately not here

There is no published Zapier app. Publishing one means an account, a review and
a listing, and it would point at a single hosted deployment, which is the one
thing a self-hosted library does not have. What is here is everything such an
app would be built on, so if you want to publish one for your own deployment,
nothing is in your way.

---

[Back to the README](../README.md)
