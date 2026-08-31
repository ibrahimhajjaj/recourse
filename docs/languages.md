# When the customer does not write English

Two separate problems: a ticket your team cannot read, and a refusal the
customer cannot read.

## Reading a ticket written in a language nobody speaks

```ts
import { createHelpdesk } from '@recourse-ai/core/helpdesk'
import { models } from '@recourse-ai/core/models'

createHelpdesk({
  store,
  translation: { target: 'en', model: models.fromEnvironment() },
})
```

Inbound customer messages get a translation in `metadata.translation`, and the
original stays in `content` untouched. Agent replies, internal notes and system
events are never translated, because a mistranslated promise sent over an
agent's name is a worse problem than a ticket somebody has to paste into a
translator themselves.

An English ticket costs nothing at all. A script check and a function-word
ratio settle it before any model is asked:

```
[en] 0.0s   detected=en  skipped=true   no model call
[ar] 74.3s  detected=ar  Hello, my order number 4471 has arrived damaged.
                         I want a replacement, not a refund. My email:
                         amina@example.com
[de] 70.8s  detected=de  Good day, my order 1042 has been in transit for
                         14 days. Tracking number DHL-99Z-771.
```

Both non-English cases kept every identifier verbatim, which is the failure
that matters here: an order number translated into words, or a decimal point
moved, turns a readable ticket into a wrong one and the agent has no reason to
doubt it.

A drafted reply comes back in the customer's own language, because the model is
otherwise reading an English thread and would answer in English to somebody who
wrote in Arabic.

## Refusing in the customer's language

The refusal messages are the one part of the safety layer a customer reads, and
they ship in English.

```ts
import { translateCategories } from '@recourse-ai/core/safety'

classifier: {
  categories: translateCategories({
    injection: 'Ik kan alleen helpen met vragen over onze producten.',
    abuse: 'Ik wil graag helpen, maar houd het alstublieft netjes.',
    crisis: 'Ik verbind u door met een collega die u verder kan helpen.',
    leak: 'Er ging iets mis met dat antwoord. Ik haal er een collega bij.',
  }),
}
```

Only the words change. The actions and sensitivities are the same policy
whatever language it refuses in, and a category you do not name keeps its
default. Name all four that speak: a Dutch shop that translates two of them
has an English sentence waiting behind the other two, and the customer who
finds it is already having the worst conversation of the day.

---

[Back to the README](../README.md)
