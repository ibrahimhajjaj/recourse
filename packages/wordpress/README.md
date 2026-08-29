# The WordPress plugin

A support agent that learns a WordPress site's own content, installed from the
admin screen rather than by pasting a script tag into a theme.

**Status: the plugin works end to end and has not yet been submitted.**
Ingestion, the index, the settings screen, the REST route and the widget are
written; Plugin Check and a real install are the remaining gate.

## Two implementations, one measured contract

The plugin's whole argument is that a shop on shared hosting needs no Node
anywhere. That means chunking, tokenising, ranking and the index format all
have to exist here, and it takes on the obvious risk: two implementations of
one policy, drifting apart, in the direction of worse answers on whichever side
nobody is measuring.

So the TypeScript writes a fixture and the PHP asserts against it, every word,
every chunk, every posting, every ranking:

```
$ composer test
OK (10 tests, 265 assertions)
```

Regenerate the fixture after touching either side:

```bash
node tools/generate-parity-fixtures.mjs
```

The suite has teeth, which was checked rather than assumed. Changing one guard
in the stemmer from `> 4` to `> 3` fails two tests; moving the keyword floor
from 0.35 to 0.15 fails the end-to-end one; shrinking the chunk budget fails
two more.

That last check found a real hole: the first version of the suite compared
every posting but not the BM25 constants, so a port using a different `k1`
passed while producing an index the core would score differently. The constants
are asserted now.

## The files

| File | What it is |
| --- | --- |
| `includes/class-tokenizer.php` | Stopwords and the stemmer |
| `includes/class-bm25.php` | The postings table and Okapi BM25 |
| `includes/class-chunker.php` | Heading-aware splitting |
| `includes/class-retriever.php` | The policy: floors, coverage, per-page cap |
| `includes/class-index.php` | Building, reading and writing the shared format |

The index format is the core's, version and all, so a shop that outgrows the
plugin can take its index to the Node service, and an index built by
`helpdeck ingest` can be dropped in here.

## PHP 7.4, decided from the numbers

wordpress.org/about/stats, read 2026-08-29: PHP 8.2 and newer is 62.3%, 8.1 is
11.8%, 8.0 is 4.2%, **7.4 is 17.7%**, and everything older adds up to 4.0%.

A floor of 8.0 shuts out 21.7% of WordPress. A floor of 7.4 shuts out 4.0%. For
a plugin whose reason to exist is installing on hosting the shop already has,
that is not a close call.

So: no `match`, no `?->`, no union types, no constructor promotion, no
`str_contains`. Checked by running the suite on a real 7.4:

```bash
npm run test:php74     # docker run --rm php:7.4-cli php vendor/bin/phpunit
```

`php -l` alone would not do it. `str_contains` parses perfectly on 7.4 and
fails when the line runs.

## Not English

The tokeniser splits on Unicode letter and number properties rather than a
Latin range, and lowercases by code point. A port written with `strtolower` and
`strlen` passes every English test and silently halves recall on an Arabic,
German or Japanese site, so the parity fixture carries all three.

`mbstring` is all but universal, and where it is missing English still works
rather than nothing at all.

## Running the tests

```bash
composer install
composer test          # or: npm test
npm run test:php74     # the floor, in docker
npm run lint           # php -l over everything
```

`npm test` skips loudly rather than failing when there is no PHP on the
machine, which is most machines running `pnpm verify`.
