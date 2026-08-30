# The WordPress plugin

A second, complete implementation, in PHP, for the far larger group of people
who own their content but do not own a build step. It is not a wrapper around
the Node library and it does not call out to it: a WordPress site installs a
plugin, points it at its own posts and pages, and gets the same answers.

```
packages/wordpress/
```

Nothing else in this repository is required to run it. No Node, no npm, no
build, no key.

## A port rather than a client

Sending a WordPress site's content to a service, or asking a shared host to run
a Node process, rules out most of the sites this would actually help. The
constraint that follows is severe and worth stating plainly: retrieval, chunking
and prompting all had to be rebuilt in PHP, on a runtime with no vector database
and often no ability to reach an embedding API at all.

So the plugin retrieves with BM25 over the site's own content, which needs no
embeddings, no external call and no storage beyond the options table. The
trade-off is real and is written down in the plugin's own README rather than
hidden.

## The contract with the Node library is measured, not assumed

Both implementations answer with the same prompt and the same conduct, and that
is not a promise, it is a test. The Node build writes fixtures and the PHP suite
asserts against them, line for line, so a change to the prompt on one side fails
the other. That guard has already caught four real divergences, including PHP
emitting one instruction twice.

```bash
cd packages/wordpress && composer install && ./vendor/bin/phpunit
```

40 tests, 324 assertions, and `php -l` plus PHP_CodeSniffer against the
WordPress coding standard in the same gate.

## PHP 7.4, decided from the numbers rather than by taste

Requiring PHP 8 would have been more pleasant to write and would have excluded a
large share of live WordPress installs. The plugin's README carries the version
distribution the decision came from.

## In it, and deliberately not in it

The plugin does retrieval, answering with citations, the admin screen, indexing
of posts, pages and WooCommerce products, ticket capture and translation.

Eleven channels, voice, attachments, the safety classifier, the four database
stores, procedures and the eval harness are all in the Node core and none of
them is in the plugin. That is a decision rather than a gap, and the reasoning
sits in [`packages/wordpress/README.md`](../packages/wordpress/README.md), which
is the deeper document: how the files are laid out, which WordPress core
abilities are used rather than reimplemented, and how it behaves on a site that
is not in English.

For the listing as wp.org will show it, see
[`packages/wordpress/readme.txt`](../packages/wordpress/readme.txt).

---

[Back to the README](../README.md)
