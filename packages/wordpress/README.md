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
OK (86 tests, 722 assertions)
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
| `includes/class-actions.php` | The action registry, and the rules the model gets with it |
| `includes/class-abilities.php` | Both directions of core's Abilities API |
| `includes/class-woocommerce.php` | Order lookup and stock, when Woo is active |
| `includes/class-tickets.php` | Where a handoff lands on a site with no help desk |

The index format is the core's, version and all, so a shop that outgrows the
plugin can take its index to the Node service, and an index built by
`recourse ingest` can be dropped in here.

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

## Actions

The agent can do things, not only answer. Actions are registered through a
filter, so a site adds one from its own plugin without knowing anything about
this one:

```php
add_filter( 'recourse_actions', function ( $actions ) {
	$actions['book_a_call'] = array(
		'description' => 'Book a call with the team. Use when somebody asks to speak to a person about a quote.',
		'fields'      => array(
			'email' => array(
				'type'        => 'string',
				'description' => 'Where to send the invitation.',
				'required'    => true,
			),
		),
		'callback'    => 'my_book_a_call',
	);

	return $actions;
} );
```

Four ship in the box. `create_support_request` and
`capture_lead` write to a private post type, so a handoff and a sales enquiry
both have somewhere to go on a site with no help desk and no CRM, and each
fires an action (`recourse_ticket_created`, `recourse_lead_captured`) for a site
that has one. `look_up_order` and `check_stock` appear only when WooCommerce is
active.

Deliberately not written into Contact Form 7, Gravity Forms or WPForms. Each
stores entries differently, two of them not at all by default, and a plugin
that writes into another plugin's tables breaks the week that plugin changes
them.

Add `relevant_when` to hold an action back until the conversation is about it:

```php
'relevant_when' => 'call meeting demo appointment book',
```

Every action's name, description and inputs are sent to the model on every
message, including "hi", and a small model choosing between twenty tools
chooses worse than one choosing between three. The test reads the visitor's
words together with the passages retrieval just found, so a question phrased in
words the action was never described with still reaches it through the page it
matched. Leave it off unless a site has enough actions for it to matter: one
the model cannot see is one it cannot use.

**An order number is not identity.** Order numbers are sequential, so anybody
holding one of their own can guess a hundred others. The lookup demands the
email the order was placed with, compares it in constant time, and answers a
wrong email exactly as it answers a missing order. Two different answers would
turn the endpoint into a way of mapping which numbers exist.

Nothing shipped writes to a shop. A model that misreads a sentence should not
be able to refund an order.

## Left to core, checked on a live 7.1

WordPress grew two things that overlap with this plugin, so both are used
rather than reimplemented.

**The Abilities API, core since 6.9** (about 76% of installs). It is a registry
of callable things with a JSON Schema and a permission callback, which is
exactly the shape a model wants. This plugin registers `@recourse-ai/core/answer` and
`@recourse-ai/core/search` there, both annotated `readonly`, so any other agent on the
site can use them. `@recourse-ai/core/search` needs no model and no credential at all.

It reads from the registry too, but only what the site names:

```php
add_filter( 'recourse_allowed_abilities', function () {
	return array( 'woocommerce/products-query' );
} );
```

Empty by default, and that is load-bearing. A stock WooCommerce registers seven
abilities and two of them are `product-delete` and `order-update-status`, while
the visitor at the other end of this chat is an anonymous member of the public.
Three gates, all verified on a live install with WooCommerce active: the site's
allowlist, then the `destructive` annotation, then the ability's own permission
callback.

```
woocommerce/product-delete   destructive=yes  anonymous=false
woocommerce/products-query   destructive=no   anonymous=false
                             as an administrator: allowed, offered as
                             woocommerce_products_query
```

**The AI Client, core since 7.0** (about 67%). When the site has a connector
configured and nothing is set here, the plugin uses it: no endpoint to paste,
no key to store, and the credential is the site's rather than this plugin's.
Core does tool calling on that path through `using_abilities()`, so abilities
work there and actions registered through the filter do not.

One trap worth knowing: `wp_supports_ai()` answers whether the client exists,
not whether a provider is connected. A site with no connector passes it and
then fails at generation, so the failure is handled where it happens.

Streaming and embeddings are not in core yet. Embeddings are targeted at 7.2,
and they are the thing that could replace this index layer entirely.

## Not in the plugin

Eleven channels, voice, attachments, the safety classifier, four database stores,
procedures and the eval harness are all in the Node core and none of them is
planned for PHP. This is the standalone path, for a site with no Node anywhere.
