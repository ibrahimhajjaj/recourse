# Doing things, not just answering

## Actions

An action is a name, a description of when to use it, and the fields it needs.

```ts
import { createChatHandler } from '@recourse-ai/core/server'
import { collectLeads, escalate, httpAction, webSearch } from '@recourse-ai/core'

createChatHandler({
  index: knowledge,
  actions: [
    collectLeads({}),
    escalate({ helpdesk }),
    webSearch(),

    httpAction({
      name: 'order_status',
      whenToUse: 'Use when the customer asks where their order is.',
      collect: [{ name: 'orderNumber', type: 'string', description: 'Their order number.' }],
      url: 'https://api.your-shop.com/orders/{{orderNumber}}',
      // The agent repeats what it is given, so it only gets what it needs.
      allowFields: ['status', 'placedAt', 'trackingUrl'],
    }),
  ],
})
```

Built in: `collectLeads`, `collectData`, `escalate`, `suggestedMessages`,
`webSearch`, `httpAction`, `clientAction`, `customButton`, `customForm`,
`slackNotify`, `scheduleMeeting`, `stripeBilling`, `shopifyOrders`, `liveChat`,
`transferToPhone`.

The commerce actions are read-only on purpose. An agent that can cancel a
subscription will eventually cancel the wrong one, and the customer will not find
out until the coffee stops arriving.


## Answering with something other than a sentence

Some answers are not a paragraph. An order is a card, three shipping options
are a table, and "start a return" is a button. The agent can render those
instead of describing them:

```ts
import { customButton } from '@recourse-ai/core'

customButton({
  whenToUse: 'When the customer wants to track an order or start a return.',
  buttons: [
    { label: 'Track my order', url: 'https://example.com/track' },
    { label: 'Start a return', url: 'https://example.com/returns' },
  ],
})
```

Four kinds ship: `button`, `card`, `table` and `list`, plus forms the customer
can fill in. Your own action emits one directly:

```ts
ctx.emit({
  type: 'ui',
  kind: 'card',
  id: `refund_${orderNumber}`,
  data: { title: `Refund for ${orderNumber}`, subtitle: 'Requested', fields: [...] },
})
```

### The id is what makes it change

Send the same `id` again and the card on screen is **replaced**, in place,
rather than a second copy appearing under it. So a refund that goes from
requested to reviewed to approved is one card that updates three times, and the
thread does not jump under somebody reading it.

```ts
ctx.emit({ type: 'ui', kind: 'card', id: 'refund_1042', data: { subtitle: 'Requested' } })
// later in the same turn, or a later turn in the same conversation
ctx.emit({ type: 'ui', kind: 'card', id: 'refund_1042', data: { subtitle: 'Approved' } })
```

Send the whole `data` object each time rather than a patch. These payloads are a
handful of fields, and a replacement has no way to be half-applied.

Omit the `id` and every frame appends, which is what you want for a card that
records something that happened rather than something in progress.

### Your own kinds

`RENDERERS` is an ordinary exported record, so a deployment adds to it:

```ts
import { RENDERERS } from '@recourse-ai/widget'

RENDERERS.progress = (data) => {
  const bar = document.createElement('progress')
  bar.max = 100
  bar.value = Number(data.percent) || 0
  return bar
}
```

A kind nothing knows how to draw renders nothing at all rather than throwing, so
an agent inventing one cannot break the thread.

## Saying what it is doing

An action that takes a few seconds should say so. Emit a frame when it starts
and when it finishes, and the widget shows it in place of the typing dots:

```ts
ctx.emit({ type: 'action', name: 'look_up_billing', status: 'running', summary: 'invoice 1234' })
const invoice = await stripe.invoices.retrieve(id)
ctx.emit({ type: 'action', name: 'look_up_billing', status: 'done' })
```

The visitor sees "Checking invoice 1234" rather than three dots for five
seconds. Without a `summary` the action's name is tidied and used, so
`look_up_billing` reads as "look up billing".

The built-in `httpAction` and the commerce lookups already do this. It steps
aside the moment the answer starts arriving, because a status line under a
half-written sentence reads as a fault.

`summary` is rendered as text, never as markup. It is written by your code and
it lands on a customer's screen.

## Procedures

Where improvising is expensive, give the agent the steps.

```ts
import { defineProcedure } from '@recourse-ai/core/procedures'

defineProcedure({
  name: 'Return or refund request',
  trigger: 'The customer wants to return an order or get a refund',
  steps: [
    'Ask for the order number if you do not already have it.',
    'Call @lookup_order with that order number.',
    {
      branches: [
        { if: 'the order is wholesale or over 5kg', then: 'Explain it is final sale.' },
        { if: 'it was delivered within 30 days', then: 'Confirm the refund and the timing.' },
      ],
      otherwise: 'Explain the window has passed, then call @escalate_to_human.',
    },
  ],
})
```

An action marked `procedureOnly` is never offered to the agent's own judgment.
It becomes callable only for the procedures that name it, so a refund tool
cannot fire because a conversation drifted somewhere suggestive.

A procedure that references an action this deployment does not have is dropped
entirely, with a warning. Half a procedure is worse than none: the agent follows
four steps, reaches a tool that is not there, and improvises the ending the
procedure existed to prevent.

## Holding an action back until it is wanted

Every action's name, description and inputs go to the model on every turn,
whether or not the conversation has anything to do with them. Eleven actions is
around three hundred and fifty tokens on a message as short as "hi". Forty-five
is over three thousand. The bill is the smaller problem; the larger one is that
a small model choosing between forty tools chooses worse than one choosing
between four.

`relevantWhen` takes a few words describing what the action is for, and the
action is offered only on turns the conversation is about it.

```ts
httpAction({
  name: 'check_stock',
  whenToUse: 'Say whether an item is in stock.',
  relevantWhen: 'stock availability sizes in store',
  // ...
})
```

On a shop with eleven actions this typically offers two to four of them per
turn, so most of the manifest never reaches the model.

The relevance test reads the whole conversation **and the passages retrieval
just found**, which matters more than it sounds. "Do you have this in a medium?"
is a stock question containing none of the words a stock action is described
with; the sizing page it retrieves contains all of them. Without the passages
the action would be dropped from exactly the turn that needed it.

Leave it unset unless you have a reason. An action the model cannot see is one
it cannot use, and a missed match is a worse failure than a wasted token. It is
also ignored for an action a procedure has already unlocked, so a flow halfway
through never loses a step because the customer replied "yes".

---

[Back to the README](../README.md)
