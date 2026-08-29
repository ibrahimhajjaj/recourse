# helpdeck on Cloudflare Workers

The chat handler is a `Request -> Response` function, which is what a Worker
is. No adapter, no polyfills, and no `nodejs_compat`.

```bash
pnpm --filter helpdeck-example-worker dev      # wrangler dev
pnpm --filter helpdeck-example-worker check    # bundle guard
pnpm --filter helpdeck-example-worker deploy   # needs a Cloudflare account
```

## The bundle guard

`npm run check` fails the build if a Node built-in reaches the Worker bundle,
or if it grows past 200 KB. That is not decoration: it caught two real problems
the first time it ran.

**Import subpaths, not the root.** `helpdeck` re-exports `ingest` and the
local-file source, which read from disk and so import `node:fs`. On a Worker
use `helpdeck/server`, `helpdeck/models`, `helpdeck/agent`, `helpdeck/actions`,
`helpdeck/channels`, `helpdeck/safety` or `helpdeck/store`, none of which
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
