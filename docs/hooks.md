# Changing what it does without forking it

Named points where you can change what happens, modelled on WordPress hooks.

Two kinds. A **filter** takes a value and returns a new one. A **listener**
watches and changes nothing.

## Registering something

```ts
import { createAgent, createHooks, openerFilter } from '@recourse-ai/core'

const hooks = createHooks()
hooks.filter('answer', openerFilter)

createAgent({ index, hooks })
```

`filter` and `on` both return a function that removes what you registered, and
both take a priority. Lower runs first, and things added at the same priority
run in the order you added them.

```ts
const stop = hooks.on('turn.end', ({ ms }) => metrics.timing('turn', ms), 5)
stop()
```

## The registry is a value, not a global

WordPress keeps one registry per process, which works because a request serves
one site. One process here can answer for several businesses, so a global would
let the shop that registered a filter have it run on another shop's answers.

`fork` keeps shared rules in one place while each tenant adds to a copy:

```ts
const house = createHooks()
house.filter('answer', openerFilter)

const forThisShop = house.fork()
forThisShop.filter('answer', theirVoice)

createAgent({ index, hooks: forThisShop })
```

A fork is a copy taken at that moment, not a live view of its parent. Adding a
house rule later does not silently change every tenant already running.

## When an extension is broken

A filter that throws is dropped for the rest of that answer and the text passes
through as though it were not there. A filter that returns something that is
not text is ignored, because an object reaching the stream renders as
`[object Object]` on somebody's screen. A listener that throws is logged, and
the turn carries on, because the thing it was watching still happened.

All of it is logged. None of it fails the turn.

## The points

| Name | Kind | Gets |
| --- | --- | --- |
| `answer` | filter | The reply, as it streams |
| `question` | filter | The search key, before retrieval |
| `turn.start` | listener | The conversation |
| `turn.end` | listener | The conversation, the answer, how long it took |

`answer` is registered as a factory rather than a function, because a reply
arrives in pieces and a filter usually needs to remember what it has seen. One
instance is built per turn, so nothing carries between conversations:

```ts
hooks.filter('answer', () => {
  let seen = ''

  return {
    push: (text) => {
      seen += text
      return text.replace(/\bcolour\b/g, 'color')
    },
    flush: () => '',
  }
})
```

Return an empty string from `push` to hold text back until the next fragment.
Whatever is still held gets `flush`ed at the end, and it still passes through
the filters registered after yours rather than escaping them.

## The one that ships

`openerFilter` cuts the throat-clearing off the front of a reply: "Certainly!",
"Great question!", "I'd be happy to help", "As an AI". The instructions already
ask the model not to write those, which a large model obeys and a small one
does not, so this is the guarantee rather than the request.

It is **not on unless you ask for it**. What counts as throat-clearing is house
style, and a library that edits somebody's answers uninvited has decided
something that was not its to decide.

It only touches the opening, and only when the phrase is followed by
punctuation. "Certainly! Delivery is..." is a tic; "Absolutely everything is
covered" is an answer, and an earlier version that matched on a space alone ate
the adverb and left the sentence meaning less than it did.

## In the WordPress plugin

The plugin uses WordPress's own hooks, because there the global registry is
correct and expected. `recourse_answer` is the same idea as `answer` above:

```php
add_filter( 'recourse_answer', function ( $text ) {
    return preg_replace( '/^(Certainly|Absolutely)[!,.]\s*/i', '', $text );
} );
```

The others are `recourse_index_post`, `recourse_document`, `recourse_actions`,
`recourse_allowed_abilities`, `recourse_show_widget`, `recourse_rate_limit`,
`recourse_order_id_from_number` and `recourse_order_tracking`.

---

[Back to the README](../README.md)
