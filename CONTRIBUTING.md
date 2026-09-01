# Contributing

Thank you for looking. This is a small project maintained in the time I have,
so the rules below exist to keep the work reviewable rather than to be
difficult. Reading them takes two minutes and saves us both a round trip.

## The rule that matters most

**You have to understand your own change.** If you cannot explain what it does
and how it touches the rest of the system, without an agent open in front of
you, it is not ready.

That is the whole bar. Everything below is detail.

## AI usage

Use whatever tools you like.

**Say so when you have.** Which tool, and how much of the work it did. One line
in the pull request is enough:

```
Written with Claude Code, which did most of the adapter and all of the tests.
```

Nobody thinks less of you for it, and it tells me where to look hardest.

Two things it does not cover. Issues and discussions can be drafted with help,
but read them back and cut them down before posting, because the unedited
version is three times longer than the point it is making. And no generated
images, audio or video.

What gets a pull request closed is not the tool. It is code the author cannot
explain, tests that assert nothing, or a diff that grew four unrelated changes
on the way.

## Talk first, then code

The issue tracker holds work that is agreed and ready to be picked up. It is
not where an idea goes to be discussed.

- **Found a bug?** Open an issue. The form asks for what you did, what happened
  and what you expected, and it asks because a report missing any of those
  costs a round trip before anyone can start.
- **Want a feature, or have an idea?** Open a discussion. If it turns into
  something well understood and worth doing, it becomes an issue and anybody
  can pick it up.
- **Just a question?** Discussion, Q&A.

**A pull request should implement an issue.** One that arrives for something
never discussed may sit a long time or be closed, not because it is unwelcome
but because deciding whether a feature belongs is slower than reviewing code,
and doing that inside a pull request is the slowest place to do it.

Two exceptions, and no need to ask first: a clear bug fix, and a documentation
fix. Send those straight in.

## Running it

```sh
pnpm install
pnpm verify        # build, then lint, then test. What CI runs.
```

Build before lint. The store adapters lint by typechecking against core's
generated declarations, so linting a fresh checkout first reports a pile of
errors from a `dist` that does not exist yet.

Per package while you work:

```sh
pnpm --filter @recourse-ai/core test:watch
pnpm --filter @recourse-ai/evals eval -- --suite retrieval
```

The Postgres suite skips itself unless you point it at a database with
pgvector, which is what CI does:

```sh
docker run -d -e POSTGRES_PASSWORD=recourse -e POSTGRES_DB=recourse \
  -p 5432:5432 pgvector/pgvector:pg16
export TEST_DATABASE_URL=postgres://postgres:recourse@localhost:5432/recourse
```

## Three things that will catch you out

**The tokeniser and the ranking exist twice.** Once in TypeScript, once in PHP,
because the WordPress plugin has to build and search its index on shared
hosting with no Node. They are held together by a fixture generated from the
TypeScript, not by hoping they stay in step. Change one and you must change the
other and regenerate:

```sh
pnpm --filter @recourse-ai/core build
node packages/wordpress/tools/generate-parity-fixtures.mjs
```

The PHP suite will tell you what the port missed. If your change should alter
what a query matches, add the case to the generator so the fixture actually
covers it.

**Nothing Node-only may reach the serving path.** The library runs on Cloudflare
Workers with no compatibility flag, and a stray `node:fs` import will not fail a
test, only a bundle. `pnpm --filter recourse-example-worker check` is what
proves it, and it runs in CI.

**Retrieval quality is asserted, not assumed.** `packages/evals` runs a fixed
corpus and fixed questions with no model and no credential. If you touch
chunking, stemming or a threshold, run it, and expect it to tell you when a
change that looked like an improvement quietly cost recall somewhere else.

## Tests

Write the test so that it fails when the thing breaks. That sounds obvious and
it is the single most common problem with tests here, mine included: an
assertion loose enough to pass either way proves nothing, and it is worse than
no test because it looks like cover.

Before you send it, break the code on purpose and watch the test catch it. If
it still passes, the test is the thing that needs fixing.

Match the surrounding style. Comments here say why a thing is the way it is,
usually because something went wrong once, and the test names read as sentences
about behaviour rather than as method names.

## Commits and pull requests

One logical change per commit. A refactor, a bug fix and a new feature are
three commits even when you did them in one sitting.

Subjects are one line, lower case after the type prefix, and say what changed
rather than why it is good. Bodies are for when the diff genuinely cannot show
the reasoning, which is rarer than it feels.

```
fix: index scripts that write no spaces between words
```

Keep the pull request to one concern. If you found a second thing on the way,
that is a second pull request, and I will be glad you found it.

## There are people here

Every issue and pull request is read by a person. Arriving with something you
have not checked yourself puts the work of validating it on someone else, which
is the one thing that makes a small project stop being fun to maintain.

Be kind in review, in both directions.

## Licence

Contributions are under the [MIT licence](LICENSE), the same as the project.
