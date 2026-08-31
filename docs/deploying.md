# Deploying it

## Cloudflare Workers

The chat handler is a `Request -> Response` function, so it runs on a Worker
with no adapter and no `nodejs_compat`:

```
Worker bundle: 129.4 KB, no Node built-ins, no nodejs_compat needed.
```

That is asserted in CI rather than claimed. `examples/worker` has the whole
setup and a bundle guard that fails the build if a Node built-in reaches the
serving path.

`@recourse/store-d1` puts the conversations in D1, reached through a binding:
no connection pool, no credential, nothing to exhaust. It passes the same
behaviour suite as the memory, file and Postgres stores. Watch the free tier's
**50 queries per invocation**, which is per request rather than per day.

`recourse/storage` puts attachments in R2 through a binding, which is the part
a Worker does better than anywhere else: no credentials in the environment and
no signature to compute. The same seam runs on S3, MinIO, Backblaze and Wasabi
through their shared API, so nothing here is Cloudflare-only.

Two things differ from Node. Import the subpaths (`recourse/server`,
`recourse/models`, ...) rather than the root, which re-exports `ingest` and so
pulls in `node:fs`. And pass the environment in with
`models.fromEnvironment(env)`, because a Worker has no `process` and reading
it throws.


## Checking a deployment before a customer does

Every credential here is passed as an option rather than read from a global,
which is the right shape and has one cost: nothing validates it until a webhook
arrives and fails. A wrong Slack signing secret looks exactly like silence.

```bash
npx recourse doctor
```

```
  FAIL  embedding model  the index was built with "nomic-embed-text" but the
                         environment says "mxbai-embed-large"
                         rebuild the index, or point OPENAI_COMPATIBLE_EMBED_MODEL
                         back at the model it was built with
  ok    index            28 chunks from 6 documents, hybrid
  ok    model            "qwen3:4b" is available
  ok    firecrawl        no key, which is fine: scrape and search are keyless
```

It asks each provider the cheapest question that proves a credential works,
reads nothing and changes nothing. Credentials come from the environment rather
than flags, so nothing secret lands in a shell history. It exits non-zero on a
failure and zero on a warning, so it belongs in a deploy step.

The check worth having on its own is the embedding one above: a query vector
from one model against stored vectors from another is not comparable, and the
symptom is bad answers rather than an error.

Reads `SLACK_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`,
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `ELEVENLABS_API_KEY` and `FIRECRAWL_API_KEY`, and skips
whatever is absent.

---

[Back to the README](../README.md)
