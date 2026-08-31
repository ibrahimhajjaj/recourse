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

---

[Back to the README](../README.md)
