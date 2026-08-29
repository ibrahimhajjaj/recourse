=== Helpdeck Support Agent ===
Contributors: ibrahimhajjaj
Tags: support, chat, search, answers, chatbot
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Answers visitor questions from your own published content, with citations back to the pages the answer came from.

== Description ==

Helpdeck reads your published posts, pages and any public custom post types, builds a keyword index from them, and answers visitors' questions out of that index. Every answer carries numbered citations pointing at the pages it came from, so a visitor can check it and you can see where a wrong answer came from.

Nothing is indexed that a visitor could not already read. Drafts, private posts, password-protected posts and post types you did not tick are all left out, and a `helpdeck_index_post` filter is there for anything else your site needs to exclude.

Retrieval runs on your own server and needs no account and no credential. Generating the answer text does: you supply an OpenAI-compatible endpoint and its key, and you pay whatever that provider charges. Until you do, the plugin makes no external request at all.

The key belongs in `wp-config.php` rather than the database if you would rather it did not travel in a backup:

`define( 'HELPDECK_API_KEY', 'your-key' );`

== External services ==

Helpdeck needs an OpenAI-compatible chat completions endpoint to write an answer. None ships with the plugin and none is contacted until you enter a base URL under Settings, so an unconfigured install makes no external request. Because you supply the base URL and the key, the service contacted is whichever one you choose, for example OpenAI, Groq, OpenRouter, or a model you host yourself. That provider's own terms of service and privacy policy govern the data you send it.

*   When it is called: on each visitor question submitted through the chat widget, and once each time an administrator presses Test Connection on the settings screen.
*   What is sent: the visitor's question, up to twelve previous turns of the same conversation, the persona text you configured, your business name (your site title unless you change it), and the passages, titles and permalinks from your published content that matched the question. Nothing is sent from drafts, private posts, or post types you did not tick.
*   What comes back: one block of answer text, shown to the visitor. Nothing else from the response is kept.

== Source code ==

The widget script shipped as `assets/helpdeck.min.js` is built from the TypeScript sources at https://github.com/ibrahimhajjaj/helpdeck, under `packages/widget/src`. The readable build is shipped alongside it as `assets/helpdeck.js`. Build it yourself with `npm install && npm run build` in that directory.

== Installation ==

1. Upload the plugin to `/wp-content/plugins/helpdeck`, or install it through the plugins screen.
2. Activate it.
3. Go to Settings, then Helpdeck. Enter your model endpoint and key, and tick the post types to index.
4. Press Rebuild Index. A large site is indexed in batches in the background.
5. Tick Enable the assistant.

== Frequently Asked Questions ==

= Does it work without an API key? =

Retrieval does, and so does the index. Writing the answer does not: that needs a model endpoint and a key, which you supply.

= What content leaves my site? =

The passages that matched the question, the question, the recent conversation, and the persona text. See the External services section above for the full list. Your site is not uploaded anywhere.

= Can I hide the widget on some pages? =

Yes. Return false from the `helpdeck_show_widget` filter.

= How large a site can it index? =

The index is built in batches on WP-Cron, so the size of the site is not the limit. The index file is read on each question, so a very large catalogue will want an object cache.

= Does it work on multisite? =

Each site in a network has its own settings and its own index. Uninstalling removes the data from every site in the network.

== Changelog ==

= 0.1.0 =
* First release.
