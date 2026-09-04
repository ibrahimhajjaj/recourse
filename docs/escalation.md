# Handing a conversation to the desk you already run

Nine desks are wired in, so the agent opens a real ticket in the system your
team already lives in rather than a second one they have to remember to check.

```ts
import { escalate } from '@recourse-ai/core/actions'
import { intercom } from '@recourse-ai/core/helpdesk'

escalate({
  createTicket: intercom({
    accessToken: process.env.INTERCOM_TOKEN!,
    ticketTypeId: 88,
  }),
})
```

Nine desks are wired: `zendesk`, `freshdesk`, `intercom`, `helpScout`,
`zohoDesk`, `hubspot`, `gorgias`, `salesforce` and `odoo`. Each is a function
returning the `createTicket` the action already took, so the call site reads the
same whichever one is behind it, and swapping desks is one line.

All of them send the transcript, so nobody has to ask the customer to explain it
twice.

All of them retry, but only where the desk plainly never took the request: too
early, too many, nothing available to serve it. A 500 or a dropped connection
can arrive after the ticket was written, and none of these APIs takes an
idempotency key, so repeating one through an ambiguous failure leaves the
customer with two tickets and an agent answering both. A customer told their
ticket was raised when it never was is still the worst thing this library can
do, which is why it retries at all.

When a desk refuses, the response body goes to the log and the thrown error
carries the status alone. The body is the only thing that explains a 422 and an
operator needs it, but that error becomes tool output, the model is told to say
plainly what did not work, and an Odoo fault arrives as a Python traceback
carrying the database name and the paths on the server.

They are shaped from each vendor's published request and none has been run
against a live account, which is a weaker claim than the channels can make and
is said here rather than left to be discovered. The awkward corners are handled
and commented where they bite: Zendesk takes an OAuth access token, since it is
retiring API tokens on 30 April 2027 and a new account has no button to make
one, though the older `{email}/token` basic auth still works while it lasts;
Freshdesk wants a number for the priority and a throwaway
password, Intercom attaches a ticket to a contact so the contact is found or
created first, and Odoo answers `200` for a failure with the reason in the body.


## What the person picking it up receives

The commonest way a handover fails is not that it did not happen. It is that it
happened and the first human reply asks the customer for something they already
gave, which from their side is worse than never having been offered a bot.

So a ticket carries more than the transcript, in the order somebody reads it:

```
They want their money back.

Summary: Refund promised on the 3rd, never arrived.
Customer seems: unhappy

Already tried:
- lookup_order: ok
- issue_refund: failed, the payment provider timed out

Conversation so far:
...
```

The summary and the mood come from the conversation insights, when they have
been generated. What was tried comes from what the agent actually ran, which is
the part a transcript cannot show: without it nobody can tell a lookup that
failed from one that was never attempted.

Every part is optional and every part is best effort. A store that cannot be
read costs the context and never the ticket, because a handover that failed to
open because a summary could not be fetched would be the worst possible trade.


## Getting out of the way once a person arrives

Opening a ticket and carrying on answering is not a handoff. The customer keeps
typing in the same window, the agent keeps replying from the documentation, and
the person who picked the ticket up is now negotiating with their own product.
Worse, the agent contradicts them: it does not know what the human just
promised.

```ts
import { createAgent } from '@recourse-ai/core'

createAgent({ index, store, takeover: true })
```

`escalate` marks the conversation as belonging to a person, and from then on the
agent stops answering in it. It still records what the customer says, which is
the point: the person reads it, and nobody has to type anything twice. What the
customer sees is one line saying a colleague has it, because silence would be
worse than a wrong answer here. They cannot tell a paused agent from a broken
one, so they ask again, and again.

Off by default, because it costs one conversation read per turn. Turn it on
wherever escalation reaches a person who will actually reply.

Hand it back when they are finished:

```ts
import { resumeAgent } from '@recourse-ai/core'

await resumeAgent(store, conversationId)
```

### Asked for, and actually here

Those are two different things and the customer should not be told the wrong
one. `escalate` has asked for somebody; nobody is on it yet, and the customer
hears that someone will reply shortly. Telling them a colleague already has it
makes them wait longer than they otherwise would.

```ts
import { assignAgent } from '@recourse-ai/core'

// When a person actually opens it.
await assignAgent(store, conversationId, 'Marcus')
```

From then on the wording changes to say a colleague has it. `pauseAgent` on its
own still counts as somebody being there, because its usual caller is a person
clicking "take over" in a dashboard and they are by definition present.

Two people clicking it in the same second is not a hypothetical on a busy desk,
so the second is refused and told who has it rather than quietly taking it:

```ts
const took = await assignAgent(store, conversationId, 'Marcus')
if (!took.assigned) return `${took.heldBy} already has this one.`
```

A manager reassigning deliberately passes `{ takeFrom: true }`, because that is
a decision rather than a race. `heldBy(store, conversationId)` reads it back,
and answers `undefined` when it cannot tell as readily as when nobody holds it,
which is why the takeover check does its own read and lets a store failure
through: "I could not tell" must not become "nobody has it" at the moment two
people are both trying to take the same conversation.

The gap between the two is also the only way to measure how long people queue.

### When nobody comes

A handover assumes somebody is on the other end of it. Out of hours, or on a
day the queue got away from the team, nobody is, and a customer who was told a
colleague would reply shortly is left holding a paused conversation for as long
as they are willing to sit there.

```ts
createAgent({
  index,
  store,
  takeover: {
    waitForPersonMs: 15 * 60 * 1000,
    unansweredMessage: 'Nobody is free just now, so I will carry on and someone will follow up by email.',
  },
})
```

Once the wait runs out the agent takes the conversation back, records
`nobody-came`, and says so before answering. The sentence matters as much as
the timeout: without it the agent simply starts talking again after twenty
silent minutes, which reads as the colleague never existing.

Unset, there is no timeout and the conversation waits indefinitely, which is
the right default for a desk with somebody on it.

### The reply has to reach them

A person answering on the ticket and a person answering the customer are not
the same event. The reply is saved on the ticket either way; getting it to the
customer means saying how, because they may be on WhatsApp, on SMS, or on a
widget that closed an hour ago:

```ts
import { createHelpdesk } from '@recourse-ai/core'

createHelpdesk({
  store,
  deliver: async ({ channel, conversationId, content }) => {
    if (channel === 'whatsapp') await whatsapp.send(conversationId, content)
  },
})
```

Without it, an agent typing a reply into the ticket queue is writing into a
record nobody outside the team will ever read. A delivery that throws is
logged and the reply stays saved, because losing the record as well would be
the worse half of a bad outcome.

### Why it ended

```ts
await resumeAgent(store, conversationId, 'nobody-came')
```

Three reasons, stored on the conversation: `person-finished`, `nobody-came`,
`customer-ended`. "What fraction of our escalations ended because nobody came"
is the question a support lead asks on day thirty, and a boolean flag cannot
answer it. Each one is a different problem with a different fix, and only the
first is a good ending.

`endedBecause(store, conversationId)` reads it back.

### Letting the customer stop waiting

Somebody who has queued for ten minutes and given up currently has one option,
which is closing the tab, and a conversation that ends that way is one nobody
can follow up. They can type `/end`, `/cancel` or `/bot` instead: the agent
takes the conversation back and records `customer-ended`.

Matched on the whole message, so "I want to end my subscription" is a support
question rather than a command.

`pauseAgent` is there too, for a dashboard where somebody clicks "take over"
rather than waiting for the agent to escalate. Both are safe to call twice, and
the flag rides on the conversation's own metadata, so every store already
supports it and there is nothing to migrate.
Turn it off per escalation with `escalate({ pause: false })` where the ticket
goes somewhere nobody replies from, such as a webhook into a reporting system:
a conversation paused for a person who will never arrive is a conversation that
stops answering.

If the store cannot be read the agent answers rather than going quiet. Talking
over a human is bad; refusing to answer anybody because the database blinked is
worse, and it fails for every conversation at once.

---

[Back to the README](../README.md)
