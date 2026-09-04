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

`suggestedMessages({ pickOne: true })` takes the text box away while its
suggestions are on screen, so the only way on is to choose one. For a guided
step with a fixed set of answers. Leave it off for ordinary support: a customer
whose question is not on the list has nowhere to put it.

The commerce actions are read-only on purpose. An agent that can cancel a
subscription will eventually cancel the wrong one, and the customer will not find
out until the coffee stops arriving.

`webSearch` reaches the open web, which is usually more reach than you want. Name
the sites it may use and it stays inside them:

```ts
webSearch({ sites: ['royalmail.com', 'dpd.co.uk'] })
```

Without that, a question about a delayed parcel can be answered from whichever
forum ranks well today, in your name.

`images: true` searches for pictures as well, and lets the answer show one where
seeing the thing is the answer: which of three fittings this is, which end of the
cable goes where. Off otherwise, since a picture of roughly the right object is
worse than none.


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
    { label: 'Pay now', url: 'https://example.com/pay', sameTab: true },
  ],
})
```

A button opens a new tab unless you set `sameTab`, which is the right default
for a reference page: the customer reads it and the conversation is still there
behind it. Checkout and sign-in are the exceptions, because both are built to
own the whole window and neither works well in a tab somebody forgets about.

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

A procedure reaches the prompt only on turns its trigger matches. Eight
ordinary procedures write out to around nine hundred tokens, and on a message
like "hi" none of them apply, so none are sent. The same test decides which of
their actions are bound, so the prompt never describes a step calling something
the model has not been given.

Matched against the whole conversation rather than the last message, so a
procedure stays in the prompt while it is being worked through: the customer
answering "LUM-1234" three turns in no longer says anything that looks like a
refund request.

An action marked `procedureOnly` is never offered to the agent's own judgment.
It becomes callable only for the procedures that name it, so a refund tool
cannot fire because a conversation drifted somewhere suggestive.

A procedure that references an action this deployment does not have is dropped
entirely, with a warning. Half a procedure is worse than none: the agent follows
four steps, reaches a tool that is not there, and improvises the ending the
procedure existed to prevent.

The same applies per channel. An action limited with `channels`, or a client
action on a channel with no browser to run it, is missing as far as a procedure
is concerned, so a procedure naming one is dropped on that channel and runs
everywhere else. References inside a branch count, even a branch this
conversation would never take: whether it gets there is not knowable until the
flow has already started.

### One procedure a turn

At most one runs. Two triggers can match at once, and following both is not a
compromise between them: the steps interleave, the agent asks for the order
number twice, and the customer reads a reply that is two conversations shuffled
together.

The one that wins is the one the conversation turned to most recently, and
failing that the one the newest message shares the most words with. So the
customer who says "LUM-1234" is still in the refund flow that asked for it,
their message naming no trigger at all, and the one who says "actually, where is
my parcel" is in the shipping flow from that turn on.

Where two really do belong together, write them as one procedure with branches
rather than two that hope to run at the same time.

## What the visitor sees while it runs

A lookup can take five seconds. Every server action reports that it started,
and then that it finished or failed, and the widget shows that instead of a
typing indicator. Nothing has to be added to an action to get it.

Add `summarise` when the name is not enough:

```ts
summarise: (input) => `Looking up ${input.order}`
```

It is shown to the visitor while they wait, so keep it short, keep it about
what they asked for, and put nothing private in it: it goes straight to the
browser. A summary that throws is dropped and the action still runs, because a
label nobody needed should never cost a lookup that was about to work.

## When the model gets stuck

A model that gets an unhelpful result sometimes tries the same thing again, and
then again. Every attempt is a real request to a real system and a round trip
somebody pays for, so a turn is bounded three ways.

**The same call twice is allowed, a third time is refused.** The second is
deliberate: a model retrying once after a transient failure is doing the right
thing. Arguments are compared regardless of the order they were written in, so
reshuffling them is not a new call. `repeatLimit` changes it, `0` turns it off.

**An action that has failed three times in a turn stops being run**, whatever
arguments it was given. This is the one the check above cannot see: a model
guessing at an order number sends a different one each time, so nothing repeats
and nothing trips, while each attempt still reaches the real system. Measured on
a model that would not stop, the step cap alone allowed six real requests; this
brings it to three. It counts failures, not calls, so looking up six orders that
all succeed is untouched. A failure is anything the model sees as `ok: false`,
whether the action threw, returned `{ ok: false, error }`, or had its result
withheld. `failureLimit` changes it.

**A turn stops after six steps** regardless, which is what bounds a model that
alternates between actions rather than repeating one. `maxSteps` changes it.

Each refusal goes back to the model as an instruction rather than an error,
because an error is a thing models retry. It names the way out: ask the customer
for what is missing, or say what could not be done.

## Writing one yourself

`httpAction` covers calling an API. When the thing you need is code rather than
a request, `defineAction` is the same shape with the body left to you:

```ts
import { defineAction } from '@recourse-ai/core'

defineAction({
  name: 'check_delivery_slot',
  whenToUse: 'They ask whether a date is available for delivery.',
  collect: [{ name: 'date', description: 'the date they asked for', required: true }],
  async execute({ date }, ctx) {
    const slots = await ourBookingSystem.slotsOn(String(date))

    return { available: slots.length > 0, next: slots[0] ?? null }
  },
})
```

Whatever `execute` returns goes back to the model as the result, so return the
answer rather than the raw record: a model handed forty fields will quote the
wrong one. Throwing is fine and expected; the message reaches the model as a
failure it can explain, redacted first, and the action stops being called after
a few failures in a turn.

`ctx` carries the conversation id, the contact, the signed private facts, and
`emit` for a frame the browser should see. It is the same context the built-in
actions get, because they are written with this.

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
