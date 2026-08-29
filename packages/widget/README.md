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

## Rendering safety

Model output is rendered by building DOM nodes, never by assigning `innerHTML`.
Script tags, event-handler attributes, iframes and `javascript:` links in model
output are rendered as inert text. This is covered by the test suite.

MIT
