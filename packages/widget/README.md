# @recourse-ai/widget

The embeddable chat UI for [recourse](https://github.com/ibrahimhajjaj/recourse).
15KB minified, no dependencies, isolated in a shadow root.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@recourse-ai/widget/dist/recourse.min.js"
  data-endpoint="/api/chat"
  data-title="Ask us anything"
  data-accent="#2563eb"
></script>
```

Or mount it yourself:

```ts
import { createWidget } from '@recourse-ai/widget'

const widget = createWidget({
  endpoint: '/api/chat',
  title: 'Ask us anything',
  suggestions: ['How do refunds work?', 'Where is my order?'],
})
```

## Script tag attributes

| Attribute | Does |
| --- | --- |
| `data-endpoint` | Where to post. The only required one. |
| `data-title`, `data-subtitle`, `data-greeting` | The header and the opening line. |
| `data-footnote` | A line under the composer, such as "You are chatting with an AI assistant". Several jurisdictions now expect a visitor to be told this without having to ask. |
| `data-accent` | One colour; everything else is derived from it. |
| `data-position` | `bottom-right` (default) or `bottom-left`. |
| `data-theme` | `light`, `dark`, or `auto` (default). |
| `data-suggestions` | Pipe separated openers: `Track my order\|Returns`. |
| `data-open` | `true` to start open. |
| `data-persist` | `false` to forget the conversation on reload. |
| `data-target` | A selector, to render inline instead of floating. |
| `data-attachments` | `true` for a paperclip, or a number for a size cap in MB. |
| `data-dictation` | `true` for a microphone. |
| `data-dictation-lang` | Overrides the page language for speech. |
| `data-dictation-cloud` | `true` to allow the browser's cloud fallback. |
| `data-call` | Path to your signed-URL route, such as `/api/voice/token`, which adds a call button. |
| `data-call-transport` | `hosted` to carry the call on your own socket instead of a voice vendor's. |
| `data-feedback` | `false` to remove the thumbs on each answer. |
| `data-copy` | `false` to remove the copy button. |
| `data-delete` | `true` to let a visitor delete their own conversation. |
| `data-invite` | A message that opens the widget itself after a pause. |
| `data-invite-delay` | Milliseconds before it does. |
| `data-deep-link` | `false` to ignore `?recourse_q=` in the page URL. |
| `data-user-id`, `data-user-hash` | A signed identity, below. |

### Linking straight to a question

A help article that ends "still stuck?" can only offer a contact form. Link to
the answer instead:

```html
<a href="/billing?recourse_q=How+do+I+change+my+VAT+number">ask about VAT</a>
```

The visitor lands on the page they were going to anyway, the panel opens, and
the question is already being answered. `rc_q` works too, for links people type
by hand. The parameter is removed from the address bar as soon as it is read, so
a refresh does not ask again and a copied URL does not carry the question.

Deliberately not `q`: that is a site search on half the web, and answering
somebody's product search in the chat window is not what they asked for. Nothing
happens on a page that has no `recourse_q`, which is why this is on by default.

### Telling the agent who this is

```html
data-user-id="cus_8813"
data-user-hash="a3f1…"
```

The hash is an HMAC of the id, computed on your server with a secret the browser
never sees. Without it a visitor can claim to be anybody by editing an
attribute, which matters the moment an action returns something private: an
order, an invoice, an address.

Actions can then refuse to answer an unverified session rather than trusting the
id it was handed.

`window.recourse` exposes `open()`, `close()`, `ask(question)`, `clear()` and
`destroy()`.

## Attachments

Off by default. `data-attachments="true"` adds a paperclip to the composer, or
give it a number for a size limit in megabytes: `data-attachments="4"`.

```js
createWidget({
  endpoint: '/api/chat',
  attachments: { maxBytes: 8 * 1024 * 1024, maxCount: 3 },
})
```

Visitors can also drop a file on the panel or paste a screenshot into the box.
Images, PDFs, plain text and Word documents are offered; the file is sent as a
base64 data URI on the same request, so there is no upload service to run.

The caps here are a courtesy, so someone learns their file is too big before
they wait for it to upload. **Set the same limits on the server**, where they
are enforced:

```js
import { createChatHandler } from '@recourse-ai/core/server'

createChatHandler({ attachments: { maxBytes: 8 * 1024 * 1024, maxCount: 3 } })
```

Without that option the server refuses every file, and the widget's paperclip
would be a button that never works. Images need a model that can see them;
documents are read server-side and work with any model.

## Dictation

Off by default. `data-dictation="true"` adds a mic to the composer, or
`dictation: { lang: 'ar-EG' }` from JavaScript.

Press to start, press again or stay quiet to stop, Escape to discard. The live
transcript appears in the box as you speak and appends to whatever was already
typed.

**The audio stays on the device.** The API now has `processLocally`, and this
sets it, because a support widget records people saying their name, address and
order number, and sending that to a browser vendor should be a decision rather
than a default. If on-device recognition is unavailable, usually a missing
language pack, dictation reports itself unavailable rather than quietly
becoming the thing that setting was meant to prevent. `data-dictation-cloud="true"`
permits the fallback if you would rather have it work.

The button is hidden entirely where the browser has no speech recognition,
which today means Firefox. A control that cannot work is worse than no control.

## Right to left

The agent answers in the language the customer wrote in, so one conversation can
hold both directions at once. Every bubble and the composer carry `dir="auto"`,
which lets the browser decide per message from its first strong character. An
Arabic answer renders as Arabic on an English page with nothing for the host to
declare, and an English answer in the same thread is unaffected.

The stylesheet uses logical properties throughout, so list markers and table
text follow the direction rather than sitting on whichever side happened to be
written down.

## Rendering safety

Model output is rendered by building DOM nodes, never by assigning `innerHTML`.
Script tags, event-handler attributes, iframes and `javascript:` links in model
output are rendered as inert text. This is covered by the test suite.

MIT

## Speaking the customer's language

Every visible word is replaceable, and a partial set is normal:

```html
<script src="/recourse.js" data-endpoint="/api/chat" defer></script>
<script>
  window.recourseConfig = {
    strings: {
      title: 'Vraag ons alles',
      placeholder: 'Typ uw vraag',
      send: 'Versturen',
    },
  }
</script>
```

Anything left out keeps its English default, so a shop translating the three
strings a customer reads most does not have to supply the other twenty.

Deliberately not machine-translated. An interface nobody on the team can read
is worse than an English one they can: the shop cannot tell whether the button
says "Send" or something embarrassing.

## Copy, and forgetting

A copy control sits under each answer, putting the text on the clipboard rather
than the markup, because somebody pasting an answer into an email wants the
sentence. It hides itself entirely where there is no clipboard, which is any
page served over plain HTTP.

`allowDelete: true` puts a bin in the header. It empties the panel, mints a new
conversation id, and asks the server to forget the old one.

```ts
import { createChatHandler } from '@recourse-ai/core/server'

createChatHandler({ index, store })   // the server side is the store
```

**Best-effort privacy, not compliance machinery.** Anyone who knows a
conversation id can delete it. Ids are minted in the browser and unguessable,
so in practice that is the person whose conversation it is, and the worst a
guess achieves is deleting a transcript the business kept. The local clear
happens first and unconditionally: if the request fails, the visitor has still
had the thing they asked for, and telling them their deletion failed is worse
than the transcript outliving it on a server they cannot see.

On the file store the words survive in the append-only log until it is
compacted. That is the honest limit of a delete on a log, and it is why this is
described as best-effort.
