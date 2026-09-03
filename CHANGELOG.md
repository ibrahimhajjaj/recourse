# Changelog

What changed between releases, and what it means for a deployment that already
runs this. Written for somebody upgrading, so the breaking parts come first and
each one says what to do rather than only what moved.

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

## 0.1.1

The first published release.
