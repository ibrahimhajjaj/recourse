# @helpdeck/widget

The embeddable chat UI for [helpdeck](https://github.com/ibrahimhajjaj/helpdeck).
15KB minified, no dependencies, isolated in a shadow root.

```html
<script
  src="https://cdn.jsdelivr.net/npm/@helpdeck/widget/dist/helpdeck.min.js"
  data-endpoint="/api/chat"
  data-title="Ask us anything"
  data-accent="#2563eb"
></script>
```

Or mount it yourself:

```ts
import { createWidget } from '@helpdeck/widget'

const widget = createWidget({
  endpoint: '/api/chat',
  title: 'Ask us anything',
  suggestions: ['How do refunds work?', 'Where is my order?'],
})
```

## Script tag attributes

`data-endpoint` (required), `data-title`, `data-subtitle`, `data-greeting`,
`data-accent`, `data-position` (`bottom-right` or `bottom-left`), `data-theme`
(`light`, `dark`, `auto`), `data-suggestions` (pipe separated), `data-open`,
`data-persist`, `data-target` (a selector, to render inline rather than
floating), `data-attachments`.

`window.helpdeck` exposes `open()`, `close()`, `ask(question)`, `clear()` and
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

## Rendering safety

Model output is rendered by building DOM nodes, never by assigning `innerHTML`.
Script tags, event-handler attributes, iframes and `javascript:` links in model
output are rendered as inert text. This is covered by the test suite.

MIT

## Speaking the customer's language

Every visible word is replaceable, and a partial set is normal:

```html
<script src="/helpdeck.js" data-endpoint="/api/chat" defer></script>
<script>
  window.helpdeckConfig = {
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
