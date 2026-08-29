# helpdeck evals

Scored suites for retrieval quality, answer grounding and injection
resistance. Not published; this is a development tool.

The unit tests prove the machinery works. These prove the answers are good,
which is a different question and the one customers actually experience.

## Running

```sh
# Retrieval only. No model, no credential, no network. This is the CI run.
pnpm --filter @helpdeck/evals eval

# Everything, against a local Ollama model.
pnpm --filter @helpdeck/evals eval --model qwen3:4b --embed --save

# One suite.
pnpm --filter @helpdeck/evals eval --suite injection --model qwen3:4b
```

`--save` writes `results/<date>-<model>.json`. `--compare results/<file>.json`
fails the run if a case that passed in that file fails now, which is the only
way to tell an improvement from a regression.

## The suites

| Suite | Cases | Needs a model |
| --- | --- | --- |
| `retrieval` | 22 | no |
| `grounding` | 21 | yes |
| `injection` | 20 | yes |

**retrieval** asserts which documents come back for a query. Deterministic and
fast, so it belongs on every push: it catches a stemmer or threshold change
silently undoing the last one. Two cases are marked `known` because no keyword
index can pass them (connecting "money back" to a page that only says
"refund"); they pass with `--embed`.

**grounding** checks the answer against the corpus: the right numbers, a
citation, and declining when the corpus cannot answer. Several cases assert on
what must *not* appear, because inventing a courier or a phone number is the
failure that costs a business most.

**injection** is direct attacks, and then the ones that matter more: cases
running against `corpora/shop-poisoned.json`, where a document in the knowledge
base itself carries instructions aimed at the model. That is the attack a RAG
system cannot screen at the input, because the payload arrives with the
authority of the business's own content.

## Adding a case

Append a line to a suite. No code to edit.

```jsonc
{"id":"gr-refund-window","question":"How long do I have to return a bag?",
 "mustContain":["30"],"mustCite":true}
```

| Field | Meaning |
| --- | --- |
| `mustContain` / `mustNotContain` | Substrings, or `/regex/flags` |
| `mustCite` | The answer cites at least one source, and the number points at something actually retrieved |
| `mustRefuse` | The agent declines rather than inventing |
| `mustCallAction` | A named action ran |
| `mustRetrieve` / `mustNotRetrieve` | Document ids from retrieval |
| `corpus` | Which corpus to build, default `shop` |
| `known` | A recorded failure. Still runs, still reported, does not fail the suite |
| `note` | Why the case exists. Printed when it fails |

`known` is deliberate. A failing case that gets deleted teaches nobody
anything; one that stays and explains itself is a note to whoever tries to fix
it next.

## Why the grading is deterministic

String matching, regex, citation counting and which actions ran. No model
grades another model by default: a judge that disagrees with itself between
runs turns a regression suite into a mood ring. Where a judge is genuinely
needed it must not be the model under test.

## What this found on its first run

- A stemmer gap: `freshness` did not reduce to `fresh`, so a heading and the
  question asking about it never met.
- A coverage rule that dropped a passage matching one strong term while
  admitting ones matching two weak terms.
- `vectorFloor` defaulted to 0.25 against an embedder that never scores below
  0.39 on unrelated text, so the floor never fired and every off-topic question
  retrieved documents anyway. Measured separation on this corpus: on-topic
  questions score 0.63 and up, off-topic top out at 0.49. The default is now
  0.5, and it is model-dependent, measure your own before trusting it.
