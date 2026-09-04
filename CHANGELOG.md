# Changelog

What changed between releases, and what it means for a deployment that already
runs this. Written for somebody upgrading, so the breaking parts come first and
each one says what to do rather than only what moved.

## 0.3.1 (unreleased)

### Fixed

**The WordPress plugin no longer ships a CDN address.** The widget loads a voice runtime from jsDelivr the first time somebody places a vendor-carried call, and that address reached the copy of the bundle inside the plugin even though the plugin never turns calls on. The plugin directory does not allow a plugin to fetch code from another host, so the widget now builds a second bundle, `dist/wordpress`, compiled without the loader; the plugin build copies that one and both build steps fail if a remote address appears in it. `call.load` is still there for a site that wants to supply its own runtime, on that build or any other.

**Two dead links in the plugin's readme.** Moonshot's model agreement and privacy policy have moved to the Kimi platform, and the old addresses redirect to a documentation index rather than to either document.

## 0.3.0 (2026-09-04)

### You have to change something

**Two actions may no longer share a name.** `createAgent` refuses to start and
says which name it is:

```ts
actions: [
  escalate({ name: 'escalate_web', channels: ['web'], helpdesk }),
  escalate({ name: 'escalate_social', channels: ['instagram'], helpdesk }),
]
```

The tool set is keyed on the name, so two actions sharing one meant the second
replaced the first: the agent was handed a tool that behaved like the wrong one
and nothing said so. Every built-in now takes a `name` for exactly this, since
two of the same kind is a real configuration rather than a mistake.

**A dashboard that reassigns a conversation has to say so.** `assignAgent` now
refuses when somebody else already holds it, and returns whether it took it:

```ts
const took = await assignAgent(store, conversationId, 'Marcus')
if (!took.assigned) return `${took.heldBy} already has this one.`
```

Code that reassigns deliberately — a manager moving a conversation rather than
two people racing for it — passes `{ takeFrom: true }` and behaves as before.
Without one of those two changes, a reassignment that used to work now silently
does nothing.

**A custom store has new assertions to pass.** `storeConformance` gained the
ticket queue, the contact lookup, and two paging rules every store here already
had to follow in SQL and now has to follow everywhere: the cursor is looked up
among all rows rather than the matching ones, and a tie on the timestamp is
broken by the id. `pageAfter` and `byNewest` from `@recourse-ai/core/store` are
the shared way to satisfy both. A store that cannot yet can decline the ticket
half with `supports: { tickets: false }`, which is said out loud in the suite
rather than skipped quietly.

**`GET /sources` no longer returns a cursor.** It returns every source, because
a list that silently stopped at two hundred was how a rebuild lost the rest. A
client paging it should read `data` and stop.

### Behaviour that changed without an API change

**One procedure runs per turn**, the one the customer turned to most recently.
Two procedures matching at once used to be described together and have both
their action sets unlocked, and following both interleaves their steps into a
reply that reads like two conversations shuffled together. The choice is judged
on what the customer said rather than the whole transcript, so the agent's own
"I can also look at returns" cannot switch the flow.

**A procedure is dropped on a channel that cannot run one of its actions**,
branches included, rather than starting and stranding the customer at the step
nothing there can carry out.

**Client actions are no longer offered to a caller that cannot run them.** They
need a browser to do the work and hand the result back, so on WhatsApp the model
used to call a form nothing could render and the turn ended with no text in it.
The customer got silence.

**The memory and file stores honour an `updatedAt` passed to `updateTicket`**,
which the SQL stores already did. Stamping "now" in one store and not another is
how the same queue comes back in a different order depending on where it lives.

### Added

**Per-channel limits.** `Action.channels` and `Procedure.channels` hold either to
the places it works. A limit beats a procedure: an action a procedure unlocks is
still withheld where it was not offered.

**Follow-up questions after every reply.** `followUps: true` asks for them
separately once the answer is done, rather than relying on the model to reach
for the tool, which smaller models forget. It costs a second call per reply, so
it is off unless you ask, and it is skipped once a person has the conversation.

**A retry control** under the newest answer. It drops that answer from what the
model sees so the second attempt starts clean, re-sends any photo that came with
the question, and keeps the rejected answer in the transcript, where it is a
documented case of this agent answering badly.

**Ticket queues sort.** `sortBy` takes `created`, `updated` or `lastMessage` and
`order` takes `asc` or `desc`, so a queue can come back in the order it is
worked. `includeTotal` adds the count. A cursor carries the ordering it was
issued for and is refused against another, rather than paging into nonsense.

**`helpdesk.stats()`** reports the queue: created, solved, the outstanding
backlog, tickets by channel and status, and median first-reply, reply and
time-to-close. None of those was a field on a ticket, so nothing could answer
them before.

**A team can hand work out its own way.** `assignment` and `maxOpenPerAgent`
are settable per team, the team's value winning, because two people on billing
and ten on general support are not the same shape.

**Routing rules and triggers match a named address** with `email`, not only its
domain.

**`ticketSource`** indexes tickets your team already answered, with a Zendesk
reader that takes solved tickets and their last public reply.

**`listTemplates` reads past its first page**, so a real approved template is no
longer reported missing because it sits further down the list, and
**`sendTemplate` takes a number written the way a CRM exports it**.

**`GET /conversations/export`** returns whole transcripts a page at a time, and
`?contactId=` on the conversation list is everything one person ever asked.

**Forms take more than a text box**: `date`, `email`, `tel` and `multiline`
controls, `multiple` and grouped `options`, and `pattern`, `minLength`,
`maxLength`, `min`, `max` with a message saying what a good answer looks like.

**A `chart` component**, bars only, with the numbers printed beside them.

**Markdown images render** in an answer, over https only.

**`webSearch({ sites })`** confines a search to the sites you name, and
`{ images: true }` lets an answer show a picture where seeing the thing is the
answer.

**`suggestedMessages({ pickOne: true })`** takes the text box away while its
suggestions are on screen, for a guided step with a fixed set of answers.

**`setOptions` and `resetOptions`** change what a running widget says, and
`open({ ask, quietly })` opens it with a question already in it.

**A greeting can be several messages.** `greeting` takes an array, and
`data-greeting` splits on a pipe, because a greeting and then what the agent can
actually help with reads better as two short messages than as one paragraph.

**`actionDetail: true`** sends what an action was called with and what it
returned to the page, for one that has to show the booking rather than merely
know one happened.

**A custom button can take the tab it is in** with `sameTab`, for a checkout or
a sign-in that is meant to own the window.

### Fixed

**Help desk rules written for `updated` now run.** They were only ever evaluated
when a ticket was created, so a desk that wrote "when a ticket is reopened, put
it back in the queue" watched it never happen with nothing to read that said
why. Rules can also match on what an update *moved*, with `changed`, which is
the question most of them actually ask.

**Six things read one page and treated it as the whole set.** A page is capped
below what these callers ask for, and asking for more is silently honoured as
the cap, so every one produced a confident wrong number rather than an error:

- `train()` rebuilt from a fifth of a large knowledge base, so the agent
  stopped knowing things with nothing to notice until the answers came back
  wrong. The source list and the summary agreed with the broken index.
- `outcomes()` said it had looked at five hundred conversations having seen two
  hundred.
- Agent workload was counted off the most recently touched tickets, so a
  backlog of unclaimed work made the busiest person on the desk look idle.
- `helpdesk.stats()` reported on the first two hundred tickets, and on the
  first page of each thread, where the reply that answered the customer and the
  event that closed the ticket both live at the end.
- A stale insight on a quiet conversation sat behind fresher ones and was never
  refreshed.
- Paging in the memory and file stores ended a walk early whenever a row you
  had already been handed stopped matching the filter.

`upTo` and `pageAfter` from `@recourse-ai/core/store` are the shared ways to
read past a page, and the last two are conformance assertions every store has
to pass.

**Two conversations touched in the same millisecond** could be handed over
twice, or never: the list had no second thing to order by, so their order was
whatever the sort happened to do.

**A withheld action result still reached the page.** When a result read as an
instruction the model was protected, but the `action` frame carrying it had
already gone out, and the same call reported both `done` and `failed`.

**A tie in ticket assignment went alphabetically.** Two agents on the same load
were separated by their id, so the one whose email sorted first took every tie
there would ever be. It goes to whoever has waited longest now, with somebody
never assigned anything counting as the longest wait. `maxOpenPerAgent` also
stops an agent being handed more once they hold that many.

**A human's reply now reaches the customer.** `helpdesk({ deliver })` closes the
loop: an agent posting on a ticket was saved and went nowhere.

**A handover the clock ran out on ends**, and the customer is told, rather than
the agent starting to talk again with no explanation.

**`collectData` saves to the store** when no handler was given, as a lead
already did.

**Every chat error carries a code**, and the rate limit takes a `message`.

## 0.2.0 (2026-09-03)

### You have to change something

**`ai` is a peer dependency now, not a dependency.** Install it yourself:

```bash
npm install @recourse-ai/core ai
```

It used to be declared both ways at once, with two different version ranges. A
consumer on an older 7.x satisfied one and not the other, so their installer
resolved a second copy of the SDK under this package. The SDK identifies models,
tools and errors by module-scoped values, so with two copies a tool built here
is not the tool your `streamText` recognises. That failure reads as "the model
ignored the tool", never as an install error, which is why it is worth the
upgrade step.

**`emailChannel` requires a `secret` and refuses to start without one.**

```ts
emailChannel({ secret: { header: 'x-webhook-secret', value: process.env.EMAIL_WEBHOOK_SECRET } })
```

Every other channel verifies a signature. No email provider signs inbound mail,
so that shared header is the only thing between your agent and anybody who finds
the URL. It was optional, which meant the safe setup was the one you had to know
to ask for.

**`createOpenAiHandler` no longer accepts five options it was ignoring.**
`identity`, `storage`, `attachments`, `analytics` and `onConversation` are now
rejected at compile time. They were accepted and silently dropped, so a
deployment could set `identity: { required: true }` on that endpoint and believe
it was refusing unverified callers while every caller stayed anonymous. If you
were passing them, delete them, and put the endpoint behind a gateway that
authenticates callers.

**`@clack/prompts` moved to optional dependencies.** Only `recourse init` uses
it. If your installer skips optional dependencies, that one command will tell
you what to install; everything else is unaffected.

### Behaviour that changed without an API change

- **A message no longer wipes the notes on its conversation.** On the D1 and
  Postgres stores, appending a message with any metadata replaced the whole
  metadata object, so an ordinary turn could erase the flag saying a person had
  taken the conversation over, and the agent would answer across them. The
  in-memory and file stores already merged. All four now agree.
- **A listing given a cursor whose row is gone ends, rather than starting
  again.** It used to return the first page, so a caller looping until the
  cursor runs out never ran out.
- **A page size outside 1 to 200 is brought inside it.** A negative number used
  to mean "every row but the last" in memory and "no limit" in SQLite.
- **The rate limiter keys on a header the caller cannot write.** It prefers the
  platform's own header and otherwise reads the last forwarded hop, not the
  first. Keying on the first let a script invent an address and take a fresh
  allowance on every request.
- **The OpenAI-compatible endpoint calls a 5xx a `server_error`.** It labelled
  everything except a rate limit an `invalid_request_error`, which tells a
  retrying client to give up on a request that would have worked a moment later.
- **A heading with nothing under it is now indexed.** A section whose only
  content is its heading used to be dropped, so a contact page whose phone
  number is the heading had no chunk containing that number. Re-ingest to pick
  those up; an index built by 0.1.x still loads unchanged.
- **The agent grounds an answer in the whole passage, headings included**, so a
  contact detail printed in a section heading is no longer reported as invented.

### Added

- `persona.fallback` also takes a map of language code to sentence, so the "I
  cannot answer that" line can be written once per language. It is chosen, never
  translated: a model asked to translate a configured sentence will also improve
  it, and an invented office hour ends up in the one line nobody checks.
- `GET /outcomes`, an Outcomes view on the admin page, and `recourse outcomes`.
  The report was computed and nothing could read it.
- Corrections can be edited in place with `PATCH /corrections/:id`, keeping the
  id, the author and the date. Editing used to mean delete and re-add.
- `logger` on the agent and chat handler options, so diagnostics can be routed,
  levelled and sampled instead of going to the console.
- `repairNumericContent`, a `fetch` wrapper for a server that sends a streamed
  token as a JSON number instead of a string. Cloudflare Workers AI needs it
  today; see `docs/models.md`.
- Optional `getConversations` and `patchMeta` on `Store`, both with fallbacks,
  so a store you wrote yourself keeps working.
- `greetingArt` on the widget, and `data-greeting-art` on the script tag. The
  panel opens larger than anything in it, and a lone greeting in the top corner
  reads as a page that has not loaded; given a picture, the greeting is centred
  under it until the first question arrives.
- The mic and the call say what they are doing in words, under the composer,
  rather than only turning the button red. Colour on its own reaches neither a
  screen reader nor everybody looking at it. The mic also swaps its glyph for a
  stop square while it runs, a call being placed is amber rather than the same
  red as one in progress, a live call shows how long it has run, and a call that
  never connected leaves a mark on the button after the error box has gone.

### Fixed for the WordPress plugin

- A customer pasting an ordinary tracking link was refused. The guard that
  strips links before hunting for a smuggled payload held a literal control
  character where a word boundary was meant, so it never stripped anything.
- The repeated-character check had never matched anything, for the same class of
  reason: a backreference had collapsed into a control character.
- Three findings the plugin dropped that the Node core reports: one signal per
  matching phrase rather than only the highest, a signal when invisible
  characters are found rather than silently cleaning them, and an invented phone
  number in an answer.
- The passage screen read a key the retriever never set, so it had never
  refused a page. The same key made every email and link in an answer look
  invented.
- The `recourse/answer` ability is annotated read-only and was not. It passed no
  topic to the gate that decides which actions the model is offered, an empty
  topic narrows nothing, so every action a site had registered was handed over,
  including one that opens a ticket and therefore writes a post. An anonymous
  caller could reach it. It now runs with no actions at all.
- The settings screen's script is enqueued rather than printed into the page, so
  it can be cached, deferred and replaced like any other asset.
- The model provider list is trimmed to those whose terms of service and privacy
  policy are named in the readme. Any other OpenAI-compatible endpoint still
  works by entering its address.

## 0.1.1

The first published release.
