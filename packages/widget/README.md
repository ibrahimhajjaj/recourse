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
floating).

`window.helpdeck` exposes `open()`, `close()`, `ask(question)`, `clear()` and
`destroy()`.

## Rendering safety

Model output is rendered by building DOM nodes, never by assigning `innerHTML`.
Script tags, event-handler attributes, iframes and `javascript:` links in model
output are rendered as inert text. This is covered by the test suite.

MIT
