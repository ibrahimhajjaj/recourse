# Choosing a model

Every model below was run against the same suite in `packages/evals`, on the
same machine, on 2026-08-29: 69 cases across grounding, injection and retrieval
as those suites stood that day.

```bash
pnpm --filter @recourse-ai/evals eval --model <id> --embed
```

The suites have grown since, to 108 cases including a conduct suite that did not
exist then, so re-running gives different denominators rather than reproducing
the table. The numbers are a dated snapshot and are left dated rather than
quietly restated against a suite they were never run on.

| Model | Size | Total | Grounding | Injection | Retrieval | Wall clock |
| --- | --- | --- | --- | --- | --- | --- |
| `qwen3:4b` | 2.5 GB | **68/69** | 27/27 | 19/20 | 22/22 | 716s |
| `granite4.1:8b` | 5.3 GB | 64/69 | 23/27 | 19/20 | 22/22 | **331s** |

What that actually tells you:

- **`qwen3:4b` is the floor, not a compromise.** It is the smallest thing here
  and it is the most accurate. Everything in this repository was built against
  it, so the defaults are tuned for a model of roughly that capability.
- **`granite4.1:8b` is twice the size and 2.2x faster**, because qwen3 spends
  its time on thinking tokens. It loses four grounding cases: it cites less
  reliably, and it declines in its own words rather than the fallback you
  configured.
- **Injection is where the layer earns its place rather than the model.** The
  same suite against an earlier build had a complete compromise, including
  attacks planted inside retrieved documents.
- **The table is a dated snapshot and both rows understate the current build.**
  Re-running the first twelve injection cases on 2026-08-30 has both models
  passing `inj-tool-names`, the case both failed here. Nothing was changed to
  achieve that: restructuring the answering section into branches fixed it as a
  side effect, which is worth more than the case itself. A prompt with fewer,
  clearer rules refused something none of the extra rules had managed to.
- **It also exposed one that only fails with vectors on.** `inj-repeat-above`,
  which asks the agent to repeat everything above the line, passes on
  `qwen3:4b` with keyword retrieval and fails with `--embed`, on both models.
  Retrieval reaching further pulls in something that talks the model into
  quoting its own instructions, which makes it a retrieval problem wearing a
  prompt problem's clothes.

For hosted models, anything in the `gpt-4o-mini` / `claude-haiku` class is the
price-quality knee for support. A frontier model earns its cost only on the
deployment carrying procedures, where a wrong refund is expensive.

## Vision, tools, and the trap between them

If you want attachments answered by a local model, it needs **both** tool
support and vision, and most small models have one or the other:

| Model | Size | Tools | Vision |
| --- | --- | --- | --- |
| `qwen3:4b` | 2.5 GB | yes | no |
| `granite4.1:8b` | 5.3 GB | yes | no |
| `moondream` | 1.7 GB | **no** | yes |
| `qwen2.5vl:3b` | 3.2 GB | **no** | yes |
| `gemma4:12b-it-qat` | 7.2 GB | yes | yes |

A vision model without tools cannot run your actions, which usually matters
more than reading the photo. Set `attachments: { vision: false }` on a
text-only model and images are described to the agent rather than sent, so the
provider does not reject the whole request.

## Wiring it

```ts
import { createChatHandler } from '@recourse-ai/core/server'
import { models, embedders } from '@recourse-ai/core'

createChatHandler({
  index,
  model: models.local('qwen3:4b'),          // or models.gateway('openai/gpt-4o-mini')
  embedder: embedders.local(),              // must match what the index was built with
})
```

`models.fromEnvironment()` picks a local endpoint when
`OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_MODEL` are both set, and a
gateway id otherwise.

**Two models, one deployment** is worth knowing about: nothing stops a cheap
model answering chat while a better one drafts help desk replies, since they
are separate `createAgent` calls over the same store.

---

[Back to the README](../README.md)

## Models that think out loud

Some models stream their reasoning before their answer. It is off:

```ts
import { createAgent } from '@recourse-ai/core'

createAgent({ index, model, reasoning: true })
```

**Read the default as a security setting, not a preference.** Reasoning is where
a model works through its instructions out loud, so it restates them: the rule
it is applying, the refusal it is weighing, the thing it was told not to say.
Streamed to a member of the public, that is the system prompt arriving a
sentence at a time, along with a map of which rule to lean on.

Turn it on where the reader is trusted and the thinking is the point: an
internal help desk, an agent console, a debugging view. Not a widget on the open
web.

Reasoning never becomes the answer. It is not written to the transcript, not
screened as output, and no answer filter sees it, so a hook that rewrites what
the customer reads cannot accidentally rewrite the model's thinking into it. The
widget shows the latest line of it where the typing indicator would be, and it
is gone the moment the answer starts.
