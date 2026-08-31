# Handing a conversation to the desk you already run

Nine desks are wired in, so the agent opens a real ticket in the system your
team already lives in rather than a second one they have to remember to check.

```ts
import { escalate } from 'helpdeck/actions'
import { intercom } from 'helpdeck/helpdesk'

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

## Getting out of the way once a person arrives

Opening a ticket and carrying on answering is not a handoff. The customer keeps
typing in the same window, the agent keeps replying from the documentation, and
the person who picked the ticket up is now negotiating with their own product.
Worse, the agent contradicts them: it does not know what the human just
promised.

```ts
import { createAgent } from 'helpdeck'

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
import { resumeAgent } from 'helpdeck'

await resumeAgent(store, conversationId)
```

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
