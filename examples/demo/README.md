# The demo

recourse answering questions about itself, from the documentation in this
repository.

One Worker serves all of it: the page, the widget bundle and the chat endpoint.
The knowledge base is built from `docs/` and the README at build time and
bundled in, so there is no database and nothing to keep running.

## Deploying it

You need a Cloudflare account. Nothing else.

```bash
npm run build                                  # index the docs, inline the widget
wrangler secret put CLOUDFLARE_AI_TOKEN        # a token with Workers AI read
npm run deploy
```

The account id is already in `wrangler.jsonc`. It is not a secret; it is in
every dashboard URL. The token beside it is, which is why it is a secret and not
a var. Create it under **AI > Workers AI > Use REST API** in the dashboard.

## Why the REST endpoint and not the AI binding

A Worker can reach Workers AI through an `ai` binding, which needs no token at
all, and that would be the better setup. It does not work today:
`workers-ai-provider@4.0.0` emits every `text-delta` twice, with the same id and
the same text, so answers arrive doubled:

```
text-delta  id=3lh6JC908AGbwwzE  "the"
text-delta  id=3lh6JC908AGbwwzE  "the"
text-delta  id=3lh6JC908AGbwwzE  " cat sat on"
text-delta  id=3lh6JC908AGbwwzE  " cat sat on"
```

Worth re-checking when that provider updates, because it would remove the only
manual step here. It is not worked around in the agent on purpose: a model
repeating a token is legitimate, so anything that collapses repeats would
corrupt real answers to paper over somebody else's bug.

That gives you `recourse-demo.<your-subdomain>.workers.dev`. Point a domain at
it from the Workers dashboard if you want a nicer one.

## What it demonstrates, and what it does not

Retrieval is keyword only. No embeddings, no vector store, nothing to sign up
for beyond the account running it, because that is the path somebody gets before
they have decided anything. A demo that needs an account to look good is
demonstrating the wrong product.

The model is Cloudflare's own, over their OpenAI-compatible endpoint, which the
`models` helper already speaks. One account, no third-party key.

## It is a public URL, so it is written like one

- **Twenty questions an hour per caller.** Enough to judge whether this is any
  good, not enough to be worth abusing.
- **Four hundred output tokens, six messages of history, five hundred characters
  a message.** All three are cost ceilings and all three suit a demo: nobody
  arrives to read six paragraphs.
- The safety layer is on, as it is everywhere else. The demo is a public target
  and the documentation it answers from is full of text about prompt injection,
  which makes it an interesting one.

Read Cloudflare's current pricing before pointing anything public at this. There
is a free allowance on both Workers and Workers AI, and it is theirs to change.
