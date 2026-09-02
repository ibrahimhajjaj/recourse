# Fixing a wrong answer without a deploy

The agent says something wrong. The person who knows it is wrong is on the
support team, reading the transcript. Until they can change it, that same wrong
answer goes out to everybody who asks the same question.

A knowledge base built at deploy time cannot be fixed by that person. It is a
file, produced by a build, shipped by a release. So the fix is a ticket, an
engineer, and a deploy, and in the meantime the agent keeps saying it.

Corrections close that loop. Somebody writes what the answer should have been,
and it applies to the next message.

```ts
import { createAgent, memoryCorrections } from '@recourse-ai/core'

const corrections = memoryCorrections()

createAgent({ index, model, corrections })
```

```bash
curl -X POST https://support.example/admin/corrections \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"question":"how do I get a refund?","answer":"Refunds now take 14 days, not 30.","author":"sam@shop.example"}'
```

Nothing is rebuilt and nothing is re-embedded. The next customer to ask gets the
corrected answer.

## Without curl

Turn the admin page on and there is a Corrections view: the list, a form, and a
remove button. The Answer gaps view gains an **Answer it** button beside every
question nobody could answer, which opens the form with that question already
filled in.

That is the loop, and it is why a read-only page was not enough. Reading a list
of questions the agent failed and being unable to do anything about them is
where this page was.

## Why it outranks your documentation

A correction is put in front of the retrieved pages rather than ranked against
them. Somebody wrote it deliberately, about a specific question that went wrong,
which is better evidence than a page that happened to share some words. Ranking
it fairly against the page it exists to override would sometimes lose, and the
whole point is that the page is wrong.

That is real authority, so the match is strict: a question has to share two
thirds of the correction's distinctive words before it applies. Retrieval can
afford to be generous because ranking sorts out a loose match. This cannot,
because it wins by construction, and a loose match here answers a question
nobody checked with an answer written for a different one.

Write the question in the customer's words, the ones that actually went wrong,
not a tidied version. That phrasing is the one most likely to come back.

## Who is allowed to write one

The routes are on the management API, behind its tokens, and they are not on the
chat endpoint. Anyone who can write a correction decides what the agent says.
That is exactly the authority a support lead should have and exactly the
authority a visitor must not.

`author` is recorded and never shown to a customer. It is there so that six
months later somebody can ask who decided this.

## What it is not

Not a knowledge base. A correction is an override for one question that went
wrong; a growing pile of them is a sign the documentation needs editing, and
that is the fix rather than a hundred overrides.

`memoryCorrections` holds them in one process, which is wrong the moment there
are two servers: a correction written on one would not exist on the other. It
satisfies a three-method interface, so back it with the database you already
have when you get there.

A correction store that cannot be read costs the correction, never the answer.
The customer gets what the documentation says, which is what they would have got
anyway; an error here would mean they get nothing.

---

[Back to the README](../README.md)
