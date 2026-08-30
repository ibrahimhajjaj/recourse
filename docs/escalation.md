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
twice. All of them retry the statuses worth retrying, because a customer told
their ticket was raised when a rate limit meant it never was is the worst thing
this library can do; a 422 is wrong input and is not repeated. And all of them
put the response body in the error rather than the status alone, since every one
of these APIs explains itself in the body and says nothing useful in the status.

They are shaped from each vendor's published request and none has been run
against a live account, which is a weaker claim than the channels can make and
is said here rather than left to be discovered. The awkward corners are handled
and commented where they bite: Zendesk authenticates as `{email}/token` rather
than the email, Freshdesk wants a number for the priority and a throwaway
password, Intercom attaches a ticket to a contact so the contact is found or
created first, and Odoo answers `200` for a failure with the reason in the body.

---

[Back to the README](../README.md)
