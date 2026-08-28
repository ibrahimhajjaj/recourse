import { renderMarkdown } from './render.js'

/**
 * Inline components the agent can put in the conversation.
 *
 * Every one is built from DOM nodes, never from an HTML string, for the same
 * reason the markdown renderer is: the data reaching these functions came from
 * a model that read the visitor's own message, and one `innerHTML` here would
 * be a cross-site scripting hole on every site running the widget.
 */

export interface UiFrame {
  kind: string
  id: string
  data: Record<string, unknown>
}

export type UiRenderer = (data: Record<string, unknown>, context: UiContext) => HTMLElement | null

export interface UiContext {
  /** Sends a value back as if the visitor had typed it. */
  submit: (text: string) => void
  /** Returns a client action's result, for forms. */
  respond: (values: Record<string, unknown>) => void
}

const SAFE_URL = /^(https?:|mailto:|tel:|\/|#)/i

function text(tag: string, value: string, className?: string): HTMLElement {
  const node = document.createElement(tag)
  node.textContent = value
  if (className) node.className = className
  return node
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/** A link, or plain text when the destination is not one we will open. */
function link(label: string, url: string, className: string): HTMLElement {
  if (!SAFE_URL.test(url)) return text('span', label, className)

  const anchor = document.createElement('a')
  anchor.textContent = label
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.className = className
  return anchor
}

const button: UiRenderer = (data) => {
  const label = str(data.label) || 'Open'
  const url = str(data.url)
  if (!url) return null

  const wrapper = document.createElement('div')
  wrapper.className = 'ui-actions'
  wrapper.appendChild(link(label, url, 'ui-button'))
  return wrapper
}

/**
 * A card: the shape an order, a product or a booking naturally takes. Fields
 * are label and value pairs, which is what makes it readable without the model
 * having to compose a sentence out of six numbers.
 */
const card: UiRenderer = (data, context) => {
  const root = document.createElement('div')
  root.className = 'ui-card'

  if (data.image && SAFE_URL.test(str(data.image))) {
    const image = document.createElement('img')
    image.src = str(data.image)
    image.alt = str(data.title)
    image.loading = 'lazy'
    image.className = 'ui-card-image'
    root.appendChild(image)
  }

  const body = document.createElement('div')
  body.className = 'ui-card-body'

  if (data.title) body.appendChild(text('h3', str(data.title)))
  if (data.subtitle) body.appendChild(text('p', str(data.subtitle), 'ui-muted'))

  const fields = Array.isArray(data.fields) ? data.fields : []
  if (fields.length > 0) {
    const list = document.createElement('dl')
    list.className = 'ui-fields'
    for (const raw of fields) {
      const field = raw as { label?: unknown; value?: unknown }
      list.appendChild(text('dt', str(field.label)))
      list.appendChild(text('dd', str(field.value)))
    }
    body.appendChild(list)
  }

  const actions = Array.isArray(data.actions) ? data.actions : []
  if (actions.length > 0) {
    const row = document.createElement('div')
    row.className = 'ui-actions'

    for (const raw of actions) {
      const action = raw as { label?: unknown; url?: unknown; send?: unknown }
      const label = str(action.label)
      if (!label) continue

      if (action.url) {
        row.appendChild(link(label, str(action.url), 'ui-button'))
        continue
      }

      // A send action types on the visitor's behalf, which keeps the
      // conversation in one place instead of opening a tab.
      const send = document.createElement('button')
      send.type = 'button'
      send.className = 'ui-button'
      send.textContent = label
      send.addEventListener('click', () => context.submit(str(action.send) || label))
      row.appendChild(send)
    }

    if (row.childElementCount > 0) body.appendChild(row)
  }

  root.appendChild(body)
  return root
}

/** A table, for the handful of rows a support answer ever needs. */
const table: UiRenderer = (data) => {
  const columns = (Array.isArray(data.columns) ? data.columns : []).map(str)
  const rows = Array.isArray(data.rows) ? data.rows : []
  if (columns.length === 0 || rows.length === 0) return null

  const wrapper = document.createElement('div')
  wrapper.className = 'ui-table-wrap'

  const element = document.createElement('table')
  element.className = 'ui-table'

  const head = document.createElement('thead')
  const headRow = document.createElement('tr')
  for (const column of columns) headRow.appendChild(text('th', column))
  head.appendChild(headRow)
  element.appendChild(head)

  const body = document.createElement('tbody')
  // Capped: a long table in a 400px panel is unreadable, and the model can
  // always be asked for the rest.
  for (const raw of rows.slice(0, 25)) {
    const row = document.createElement('tr')
    const cells = Array.isArray(raw) ? raw : columns.map((column) => (raw as Record<string, unknown>)[column])
    for (const cell of cells) row.appendChild(text('td', str(cell)))
    body.appendChild(row)
  }
  element.appendChild(body)

  wrapper.appendChild(element)
  return wrapper
}

/** A list of choices the visitor can pick from. */
const list: UiRenderer = (data, context) => {
  const items = Array.isArray(data.items) ? data.items : []
  if (items.length === 0) return null

  const root = document.createElement('div')
  root.className = 'ui-list'

  for (const raw of items) {
    const item = raw as { title?: unknown; subtitle?: unknown; url?: unknown; send?: unknown }
    const title = str(item.title)
    if (!title) continue

    const entry = document.createElement(item.url ? 'a' : 'button')
    entry.className = 'ui-list-item'

    if (entry instanceof HTMLAnchorElement && SAFE_URL.test(str(item.url))) {
      entry.href = str(item.url)
      entry.target = '_blank'
      entry.rel = 'noopener noreferrer'
    } else if (entry instanceof HTMLButtonElement) {
      entry.type = 'button'
      entry.addEventListener('click', () => context.submit(str(item.send) || title))
    }

    entry.appendChild(text('span', title, 'ui-list-title'))
    if (item.subtitle) entry.appendChild(text('span', str(item.subtitle), 'ui-muted'))
    root.appendChild(entry)
  }

  return root.childElementCount > 0 ? root : null
}

/**
 * A form, so six pieces of information are one interaction rather than six
 * questions. Submitting returns the values as a client action result.
 */
export function renderForm(
  definition: { title?: string; submitLabel?: string; fields?: unknown[] },
  context: UiContext,
): HTMLElement {
  const form = document.createElement('form')
  form.className = 'ui-form'

  if (definition.title) form.appendChild(text('h3', definition.title))

  const fields = Array.isArray(definition.fields) ? definition.fields : []
  const inputs: Array<{ name: string; element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement }> = []

  for (const raw of fields) {
    const field = raw as {
      name?: unknown
      label?: unknown
      type?: unknown
      placeholder?: unknown
      required?: unknown
      options?: unknown
    }
    const name = str(field.name)
    if (!name) continue

    const label = document.createElement('label')
    label.className = 'ui-field'
    label.appendChild(text('span', str(field.label) || name))

    let element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

    if (Array.isArray(field.options) && field.options.length > 0) {
      const select = document.createElement('select')
      for (const option of field.options) {
        const node = document.createElement('option')
        node.value = str(option)
        node.textContent = str(option)
        select.appendChild(node)
      }
      element = select
    } else if (field.type === 'boolean') {
      const input = document.createElement('input')
      input.type = 'checkbox'
      element = input
    } else {
      const input = document.createElement('input')
      input.type = field.type === 'number' ? 'number' : 'text'
      if (field.placeholder) input.placeholder = str(field.placeholder)
      element = input
    }

    element.name = name
    if (field.required !== false && element instanceof HTMLInputElement && element.type !== 'checkbox') {
      element.required = true
    }

    label.appendChild(element)
    form.appendChild(label)
    inputs.push({ name, element })
  }

  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.className = 'ui-button'
  submit.textContent = definition.submitLabel || 'Send'
  form.appendChild(submit)

  // Replacing the contents removes the inputs but not this listener, so a
  // double click would otherwise submit the same claim twice.
  let submitted = false

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (submitted) return
    submitted = true

    const values: Record<string, unknown> = {}
    for (const { name, element } of inputs) {
      values[name] =
        element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value
    }

    // Replaced by a confirmation, so nobody submits the same form twice.
    form.replaceChildren(renderMarkdown('Thanks, sending that now.'))
    context.respond(values)
  })

  return form
}

export const RENDERERS: Record<string, UiRenderer> = { button, card, table, list }

/** Renders a ui frame, or null when nothing knows how to draw it. */
export function renderUi(frame: UiFrame, context: UiContext): HTMLElement | null {
  const renderer = RENDERERS[frame.kind]
  return renderer ? renderer(frame.data, context) : null
}
