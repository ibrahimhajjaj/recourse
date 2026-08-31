=== Recourse - AI Chatbot for Customer Support ===
Contributors: ibrahimhajjaj
Tags: chatbot, ai chatbot, customer support, live chat, helpdesk
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

An AI chatbot that answers customer questions from your own posts and pages, and puts a citation under every answer.

== Description ==

Recourse is an AI chatbot for customer support that answers out of your own content. It reads your published posts, pages and any public custom post types, builds a search index from them, and answers visitors' questions from that index. Every answer carries numbered citations pointing at the pages it came from, so a visitor can check it and you can see where a wrong answer came from.

Nothing is indexed that a visitor could not already read. Drafts, private posts, password-protected posts and post types you did not tick are all left out, and a `recourse_index_post` filter is there for anything else your site needs to exclude.

Retrieval runs on your own server and needs no account and no credential. Generating the answer text does: you supply an OpenAI-compatible endpoint and its key, and you pay whatever that provider charges. Until you do, the plugin makes no external request at all.

Under Settings there is a Model Provider picker that fills the endpoint in for
you. These all speak the OpenAI chat format and all work:

*   OpenAI, `https://api.openai.com/v1`
*   Anthropic (Claude), `https://api.anthropic.com/v1`
*   xAI (Grok), `https://api.x.ai/v1`
*   DeepSeek, `https://api.deepseek.com/v1`
*   Groq, `https://api.groq.com/openai/v1`
*   OpenRouter, `https://openrouter.ai/api/v1`
*   Mistral, `https://api.mistral.ai/v1`
*   Moonshot (Kimi), `https://api.moonshot.cn/v1`
*   Alibaba Qwen, `https://dashscope.aliyuncs.com/compatible-mode/v1`
*   Zhipu (GLM), `https://open.bigmodel.cn/api/paas/v4`
*   Ollama on your own server, `http://localhost:11434/v1`

The list is a convenience, not a limit. Anything else speaking the same format
works if you type its address in, and the boxes stay editable after you pick.

The key belongs in `wp-config.php` rather than the database if you would rather it did not travel in a backup:

`define( 'RECOURSE_API_KEY', 'your-key' );`

== External services ==

Recourse needs an OpenAI-compatible chat completions endpoint to write an answer. None ships with the plugin and none is contacted until you enter a base URL under Settings, so an unconfigured install makes no external request. Because you supply the base URL and the key, the service contacted is whichever one you choose, for example OpenAI, Groq, OpenRouter, or a model you host yourself. That provider's own terms of service and privacy policy govern the data you send it.

*   When it is called: on each visitor question submitted through the chat widget, and once each time an administrator presses Test Connection on the settings screen.
*   What is sent: the visitor's question, up to twelve previous turns of the same conversation, the persona text you configured, your business name (your site title unless you change it), and the passages, titles and permalinks from your published content that matched the question. Nothing is sent from drafts, private posts, or post types you did not tick.
*   What comes back: one block of answer text, shown to the visitor. Nothing else from the response is kept.

== Works with what your site already has ==

On WordPress 6.9 and later the assistant registers itself with the Abilities
API, so other tools on your site can use it, and it can call abilities other
plugins register once you list them. Nothing is called without you naming it,
and an ability marked as destructive is refused even then.

On WordPress 7.0 and later, if your site already has an AI connector set up
under Settings, the assistant will use it and you do not need to enter an
endpoint or a key here at all.

== Telling visitors they are talking to software ==

The chat window says "Automated assistant. Answers can be wrong." under the
assistant's name. The EU AI Act has required that disclosure of visitor-facing
chatbots since 2 August 2026, and the duty falls on the site rather than on the
plugin, so the wording is yours to change through the `recourse_ai_disclosure`
filter. It is there by default rather than absent.

== Source code ==

The widget script shipped as `assets/recourse.min.js` is built from the TypeScript sources at https://github.com/ibrahimhajjaj/recourse, under `packages/widget/src`. The readable build is shipped alongside it as `assets/recourse.js`. Build it yourself with `npm install && npm run build` in that directory.

== Installation ==

1. Upload the plugin to `/wp-content/plugins/recourse`, or install it through the plugins screen.
2. Activate it.
3. Go to Settings, then Recourse. Enter your model endpoint and key, and tick the post types to index.
4. Press Rebuild Index. A large site is indexed in batches in the background.
5. Tick Enable the assistant.

== Frequently Asked Questions ==

= Does it work without an API key? =

Retrieval does, and so does the index. Writing the answer does not: that needs a model endpoint and a key, which you supply.

= What content leaves my site? =

The passages that matched the question, the question, the recent conversation, and the persona text. See the External services section above for the full list. Your site is not uploaded anywhere.

= Can I hide the widget on some pages? =

Yes. Return false from the `recourse_show_widget` filter.

= How large a site can it index? =

The index is built in batches on WP-Cron, so the size of the site is not the limit. The index file is read on each question, so a very large catalogue will want an object cache.

= Does it work on multisite? =

Each site in a network has its own settings and its own index. Uninstalling removes the data from every site in the network.

== Screenshots ==

1. A visitor's question answered from the site's own Shipping page, with a numbered citation under the answer naming the page and the section it came from.
2. The same conversation asking something the site does not document. The assistant says so and hands over an email address instead of inventing an answer.
3. The settings screen: which post types to index, the persona and tone, the model endpoint, and the accent colour.
4. Rebuilding the index, which reports how many documents it holds and how large it is.

== Changelog ==

= 0.1.0 =
* First release.
