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

Put your account id in `wrangler.jsonc` under `vars.CLOUDFLARE_ACCOUNT_ID`. It
is not a secret; it is in every dashboard URL. The token beside it is.

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
