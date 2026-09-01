# recourse on Cloudflare Workers

The chat handler is a `Request -> Response` function, which is what a Worker
is. No adapter, no polyfills, and no `nodejs_compat`.

```bash
pnpm --filter recourse-example-worker dev      # wrangler dev
pnpm --filter recourse-example-worker check    # bundle guard
pnpm --filter recourse-example-worker deploy   # needs a Cloudflare account
```

## The bundle guard

`npm run check` fails the build if a Node built-in reaches the Worker bundle,
or if it grows past 200 KB. That is not decoration: it caught two real problems
the first time it ran.

**Import subpaths, not the root.** `recourse` re-exports `ingest` and the
local-file source, which read from disk and so import `node:fs`. On a Worker
use `@recourse-ai/core/server`, `@recourse-ai/core/models`, `@recourse-ai/core/agent`, `@recourse-ai/core/actions`,
`@recourse-ai/core/channels`, `@recourse-ai/core/safety` or `@recourse-ai/core/store`, none of which
touch the filesystem.

**There is no `process`.** Reading it throws rather than returning undefined,
so anything reading configuration has to be handed the environment instead:

```ts
export default {
  async fetch(request: Request, env: Env) {
    // The variables arrive with the request. There is no global to read.
    return createChatHandler({ index, model: models.fromEnvironment(env) })(request)
  },
}
```

## Local variables

`wrangler dev` does not forward your shell environment into the Worker, which
is right and surprising exactly once. Put them in `.dev.vars` (git-ignored):

```
OPENAI_COMPATIBLE_BASE_URL = "http://localhost:11434/v1"
OPENAI_COMPATIBLE_MODEL = "qwen3:4b"
OPENAI_COMPATIBLE_API_KEY = "ollama"
```

Without them the handler falls back to a bare model id, which routes through
the Vercel AI Gateway, and that provider reads `process.env`, so on a Worker
it fails with `process is not defined` rather than an authentication error.
Pass an explicit model instead.

## Verified

`wrangler dev` against a local Ollama, 2026-08-29:

```
sources: 6
Delivery times vary by region: United Kingdom (1-2 working days),
Ireland and EU (3-5 working days) [4]
```

Bundle: 117.9 KB including a 44 KB knowledge index, zero Node built-ins.

## Attachments in R2

`wrangler.jsonc` binds a bucket as `ATTACHMENTS`, and `wrangler dev` backs it
with local storage until you create the real one:

```bash
wrangler r2 bucket create recourse-attachments
wrangler secret put RECOURSE_UPLOAD_SECRET   # any long random string
```

Two routes appear when both are present, and neither exists without them:

```bash
# Upload. Answers { key, token }.
curl -X POST http://localhost:8798/api/upload \
  -H 'x-file-type: text/plain' -H 'x-file-name: complaint.txt' \
  --data-binary @complaint.txt

# Then ask about it, sending the key and token instead of the bytes.
curl -X POST http://localhost:8798/api/chat -H 'Content-Type: application/json' -d '{
  "message": "what does my complaint say?",
  "attachments": [{ "name": "complaint.txt", "mimeType": "text/plain",
                    "key": "<key>", "token": "<token>" }]
}'
```

Verified locally against a real binding, which is where the answer below came
from:

```
Your attached complaint file says Order 8823 arrived with the seal broken and
coffee spilled through the box. You're asking for a replacement, not a refund.
```

**A key from a browser is a claim, not a credential.** `/api/file` and the chat
path both verify the token before reading anything, and answer 404 either way
when they cannot, a different message for "not yours" and "not there" would
turn the endpoint into a way of mapping the bucket.

The binding cannot sign a URL; that is an S3-API feature and R2 bindings have
no equivalent. So images go to the model as bytes here rather than as links,
which is also the only thing that works for a model on a private network. If
you want links, put a custom domain on the bucket and pass it as `publicBase` , 
and be sure the objects are not secret, because a public base is public.

## Taking a call

A Worker is the one place this library can carry a spoken call without a server
to keep running: `WebSocketPair` is native here, so there is no upgrade to
negotiate. `/api/voice/call` accepts a socket, receives the microphone, and
sends speech back.

It needs a transcriber and a voice, and refuses the socket when it has neither.
That is deliberate: a socket that opens and then never answers reads as a broken
network to whoever is on the other end.

```bash
wrangler secret put TRANSCRIBE_BASE_URL   # any OpenAI-compatible transcription endpoint
wrangler secret put TRANSCRIBE_API_KEY
wrangler secret put ELEVENLABS_API_KEY
```

Then point the widget at it and the same call button uses this instead of a
voice vendor:

```html
<script
  src="/recourse.js"
  data-endpoint="/api/chat"
  data-call="/api/voice/call"
  data-call-transport="hosted"
></script>
```

What you get for running it yourself is that the answer comes from the same
agent that answers the chat, so the persona, the classifier and the procedures
still govern what is said. What you take on is the speed of the transcriber and
the voice, which is the whole latency budget on a call.
