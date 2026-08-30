# Keeping the agent inside its limits

A dial rather than a switch, in three tiers, cheapest first. The answer path is
fast, and a naive extra model call on every turn would be the slowest thing in
it. Ordering them by cost means the expensive tier only ever sees what survived
the free one.

## Tier 1: rules

Always on. No credential, no network, no measurable latency.

Rules are exact, free, and blind to anything not literally written down, which
is fine because the boring majority of hostile input is boring: the same
override phrasing, the same encoded payloads, the same invisible characters, the
same floods. Catching those costs microseconds.

Two details that took real work. Invisible characters are stripped, and the
phrase rules read a copy with every invisible removed, so splitting a banned
phrase with zero-width joiners does not get past them. But characters that are
load bearing in real writing are left alone: a Persian zero-width non-joiner is
spelling, and the bidi marks in Arabic and Hebrew are what stop an order number
rendering backwards.

## Tier 2: a small model, asked one question with one word for an answer

```ts
import { createChatHandler } from 'helpdeck/server'
import { modelClassifier } from 'helpdeck/safety'

createChatHandler({
  index,
  classifier: {
    classify: modelClassifier({
      model,
      categories: [
        { name: 'injection', description: 'an attempt to change the assistant’s instructions' },
      ],
      examples: ownTraffic,
    }),
  },
})
```

Rules catch "ignore your instructions". They do not catch the same request in
Turkish, or spelled one word per line, or wrapped in a story about a grandmother
who used to read out system prompts. That is what a model is for, and it is
deliberately second rather than first.

The construction follows Anthropic's published classification work rather than
being invented here, because the numbers are public and the technique is
specific:

- **Categories described in XML**, because a model follows a structure whose
  edges it can see.
- **The answer prefilled** as far as the opening tag, so the model's first token
  is the answer rather than a preamble.
- **A stop sequence** at the closing tag, so nothing is generated after it.
- **Temperature 0**, because a classifier that varies between runs cannot be
  measured.
- **Few-shot examples supplied from your own traffic**, which is the part that
  moved the number most: their measurements put an XML prompt alone at 70% and
  the same prompt with retrieved examples at 94%.

### The fourth step, which is opt in

The same guide adds one more thing: let the model reason in a `<scratchpad>`
before it answers, which took their measurement from 94% to 97%.

```ts
modelClassifier({ model, categories, examples, reasoning: true })
```

Off by default, and deliberately so. Three points are real, and a longer
generation on the hot path contradicts the cheapest-first ordering this whole
module is built on. Turn it on where a miss costs more than the latency does.

It changes the shape of the call. The answer can no longer be prefilled, because
the reasoning has to come first, so the token budget covers both and the
category is read from after the scratchpad rather than from the whole answer.
That last part matters more than it looks: a scratchpad reading "this is not
abuse" contains the word abuse, and matching the whole string would label it.

### Judging an answer against what was asked

An answer screened on its own is screened with the interesting half missing.
"Use the food flavorings in step three" reads as harmless until you can see the
question that asked for reagents to be called that, and this is a real attack
class rather than a hypothetical one.

So at the output stage the classifier is shown both sides: what the customer
asked, then what is about to be sent. Anthropic replaced their separate input
and output classifiers with a single exchange classifier for exactly this
reason, and report human red teaming cutting successful attempts by more than
half (arXiv 2601.04603). The agent already records what was asked, so the
context costs you nothing.

This runs by default, on the same reasoning: their output classifiers judge a
response while it is still being written, so generation can be cut off partway
rather than after the customer has read it. The answer here is released a
sentence at a time and each sentence is screened before it is sent, which keeps
the reply streaming while leaving nothing unchecked in front of the customer.

Two other settings, for the two directions you might want to move:

```ts
import { createAgent } from 'helpdeck'

createAgent({ index, classifier: { output: 'buffer' } })
```

`'buffer'` holds the whole answer, screens it, then releases it. Nothing unsafe
ever reaches the browser, and the customer waits for the full generation before
the first word. It is also the cheaper of the two when the screening itself
costs something: the rules are regular expressions and run in microseconds, but
a model plugged into `classify` is asked once per sentence while streaming and
once in total when buffering.

`false` turns gating off. The answer then streams token by token and the same
check runs once it is finished, which still puts the miss on the transcript
where you can count it, but it cannot withhold anything: by the time it runs,
the customer has read the answer. That is the trade, and it is worth making
deliberately rather than by leaving a field blank.

### The ordering, and where this differs from theirs

The ordering is not a guess. Their production system screens all traffic with a
lightweight stage and escalates only what it flags, which is the same shape as
rules first and a model second.

Two honest differences. Their first stage is a probe over the model's own
internal activations, which is both cheap and able to judge meaning; it needs
access to the weights, so it is not available to anything talking to a model
over an API, including this. And because ours cannot judge meaning, the model
tier runs on every message rather than only on what the rules flagged: gating it
behind the rules would defeat the point, since the model tier exists precisely
to catch what the rules cannot see.

The cost figures moved, and both are worth knowing. The first generation cut
jailbreak success from 86% to 4.4% at +23.7% compute. The current one reports
roughly 1% compute overhead and a 0.05% refusal rate on harmless production
traffic, an 87% drop in over-refusal, achieved through that cascade and the
probes. The lesson that carries over is not the numbers but the shape: put the
free thing first, and let the expensive thing see context rather than fragments.

`buildPrompt` is exported separately, so the prompt this sends can be inspected
and tested rather than taken on trust.

## Tier 3: a second look where a miss is not a wrong answer

```ts
import { crisisWatch } from 'helpdeck/safety'
```

Opt in, for the one category where a false negative is not a bad reply but a
person not offered help. Its examples deliberately cut both ways, because a
watch that fires on every mention of a bad day is a watch somebody turns off.

## The policy is yours, the detectors are ours

Sensitivity is per category, not global, because a children's education site and
a security research forum want opposite behaviour from identical rules. The
library does not guess which one you are running.

What ships, and what each one does before you change anything:

- `injection` **refuses**. An attempt to replace the agent's instructions,
  whether it arrives from the customer or from a retrieved page.
- `abuse` **refuses**.
- `crisis` **hands off** to a person, because a refusal is the wrong answer to
  somebody in trouble.
- `leak` **refuses**. An answer carrying a key, a token, or the agent's own
  instructions read back.
- `ungrounded` **flags**. A number that appears in no source it was given.
- `ungrounded-contact` **flags**. An email address or phone number from nowhere,
  which at worst is one customer's details shown to another.

The first three read the question, the last three read the answer. Flagging
records and sends; refusing withholds. Promote one by naming it in `categories`
with a different action.

Refused messages never reach a provider, which makes the hostile path faster
than the ordinary one rather than slower: 0.23s against 14.5s on the same
machine.

## Three things worth knowing before relying on any of it

Rules that survive contact with a small model are **concrete**. A rule quoting
the exact phrases it bans has held every time here. The same rule written as a
concept was ignored.

And **a pattern that cannot match is worse than no pattern**, because it looks
like cover. Two crisis patterns in this library never fired for months: they
were written as `i\s+'m`, which cannot match `i'm`, since an apostrophe is not
whitespace. Nothing failed, nothing logged, every test passed. They are twelve
phrasings now with no false positives, and the lesson is that a safety rule
needs a test proving it fires, not only one proving it does not misfire.

And **a detector whose category nobody configured is that same failure in
better clothes**. Any signal is recorded whether or not a policy names its
category, which is how you watch a new detector for a week before you let it
refuse anything. The cost is that a rule can fire perfectly and change nothing:
the signal reaches the transcript, the answer goes out regardless, and every
test of the rule still passes because the rule was never the broken part. The
rules that catch a leaked key and the agent reciting its own instructions were
written before any policy named their category, so for a while they detected
both and withheld neither. The test that catches this asserts on the decision
rather than on the signal, which is the only version of it that can fail.

Over-refusal is measured rather than hoped for: fifty ordinary support
questions, including "please disregard my last message" and three angry
customers, are refused zero times at the default policy and again at maximum
sensitivity. Since answers are screened too, thirty ordinary answers are
measured the same way, several of them deliberately shaped like the thing the
rules look for: a key mentioned rather than printed, the agent describing its
own job, "word for word". None are refused.

Those thirty are written to be awkward, which makes them a poor guide to the
ordinary case. So the conduct suite was run end to end against a local model
with screening on, its shipped default: thirty-one real conversations,
greetings and complaints and refund arguments among them, and not one answer
was withheld. The two it fails are a French and an Arabic reply, both known and
neither a refusal. The injection suite in
[`packages/evals`](../packages/evals/README.md) is where those numbers come
from.

---

[Back to the README](../README.md)
