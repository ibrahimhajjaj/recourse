# When the customer does not write English

Three separate problems: nothing found, a ticket your team cannot read, and a
refusal the customer cannot read.

## Finding the page that answers a question asked in another language

The one that hurts most, because it looks like the agent has no answer rather
than like a bug. Your help pages are in English. Somebody asks about delivery
in Arabic. Retrieval compares the question against the text of the pages, there
is nothing in an English index for it to match, and the agent apologises for
not knowing something it has written down.

```ts
import { createAgent } from '@recourse-ai/core'

createAgent({
  index,
  model,
  searchLanguage: { language: 'English', model: fastModel },
})
```

Only the search key is translated. The question the model answers is still the
customer's, so the reply comes back in their language and nothing is lost on
the way. One small call, and only when it is needed: a script check and a
function-word test settle an English question for free.

It costs nothing at all when your embedder does not need it. An embedding model
that places every language in one space already matches an Arabic question to
an English passage, so translating first would pay for a call to arrive where
retrieval already is. That is decided from the model the index was built with,
not asked of you. Override it when you run something in-house it cannot
recognise:

```ts
searchLanguage: { language: 'English', model: fastModel, multilingualEmbeddings: true }
```

Set `language` to whatever your content is written in. A French shop asked in
French translates nothing; a French shop asked in English translates that.

### What the keyword half does on its own

Worth knowing, because it is the half that runs with no credentials at all.

Words are found the way the language writes them. Japanese, Chinese, Thai,
Khmer, Lao and Burmese put no spaces between words, so they are indexed as
overlapping character pairs rather than split on a space that is not there.
Korean is written with spaces and is left alone.

One word gets one spelling. Arabic vowel marks and Hebrew points are optional
to write, so they are removed before matching and the careful spelling of a
word finds the plain one. The Arabic letters people use interchangeably are
collapsed the same way: alef with and without its hamza, final ya against alef
maqsura, ta marbuta against ha. Accents are composed first, so the same word
matches itself whichever editor typed it.

Stemming is English and only English. Content in another language is still
indexed and still found, it just gets no help connecting a plural to its
singular.

**Rebuild your index after upgrading if your content is not in Latin script.**
The terms changed, and a query tokenised the new way will not match an index
built the old way.

## Speaking back in the language you were called in

On a call the agent carries itself, the caller's language is detected from what
they actually said and the answer is spoken by a voice that can pronounce it.

```ts
import { attachCall, openAiCompatibleVoice } from '@recourse-ai/core/channels'

attachCall(socket, {
  agent,
  transcriber,
  voice: english,
  voices: { ar: arabic, ja: japanese },
})
```

Keyed by two-letter code. A language with no entry uses `voice`, so a
deployment that needs one voice configures none of this, and the choice is made
per turn rather than per call: somebody who switches language halfway through
is followed.

You need this when your speech provider ships one model per language rather
than one multilingual model, which several do. Reading an Arabic sentence out
of an English-only model produces sounds, not words. With a multilingual voice
there is nothing to set.

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
