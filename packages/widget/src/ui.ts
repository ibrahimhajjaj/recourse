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
  /**
   * Runs a handler the host page registered, without going back through the
   * model. For the buttons whose whole job is to do one thing: cancel a
   * booking, copy a code, add to a basket.
   */
  run?: (name: string, payload: Record<string, unknown>) => Promise<unknown>
}

const SAFE_URL = /^(https?:|mailto:|tel:|\/|#)/i

/**
 * Whether a part of a component should be shown.
 *
 * A component is data emitted by an action you wrote, so most conditionals
 * belong in that action where a real language is available. This covers the
 * one case that cannot: a value the visitor changes after the component was
 * already drawn.
 */
export function visible(item: { showIf?: unknown }, data: Record<string, unknown>): boolean {
  const condition = item.showIf
  if (condition === undefined) return true
  if (typeof condition === 'boolean') return condition

  if (typeof condition === 'string') {
    // "status" is truthy, "!status" is falsy, "status=shipped" compares.
    const negated = condition.startsWith('!')
    const body = negated ? condition.slice(1) : condition
    const [key, expected] = body.split('=', 2)
    const value = data[(key ?? '').trim()]
    const result = expected === undefined ? Boolean(value) : String(value) === expected.trim()
    return negated ? !result : result
  }

  return true
}

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
function link(label: string, url: string, className: string, sameTab = false): HTMLElement {
  if (!SAFE_URL.test(url)) return text('span', label, className)

  const anchor = document.createElement('a')
  anchor.textContent = label
  anchor.href = url
  // A new tab by default, because leaving the page usually means abandoning the
  // conversation. Checkout and sign-in are the exceptions: those are meant to
  // take the whole window, and a chat left open behind them is worse.
  if (!sameTab) anchor.target = '_blank'
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
  wrapper.appendChild(link(label, url, 'ui-button', data.sameTab === true))
  return wrapper
}

/**
 * A card: the shape an order, a product or a booking naturally takes. Fields
 * are label and value pairs, which is what makes it readable without the model
 * having to compose a sentence out of six numbers.
 */
interface ActionSpec {
  label?: unknown
  url?: unknown
  send?: unknown
  /** Name of a handler the host registered, run without asking the model. */
  run?: unknown
  payload?: Record<string, unknown>
  /** Shown after the handler succeeds, in place of the button. */
  done?: unknown
  showIf?: unknown
}

/** One action: a link, a message on the visitor's behalf, or a handler call. */
function actionButton(action: ActionSpec, context: UiContext): HTMLElement | null {
  const label = str(action.label)
  if (!label) return null

  if (action.url) return link(label, str(action.url), 'ui-button')

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'ui-button'
  button.textContent = label

  if (action.run) {
    button.addEventListener('click', async () => {
      if (!context.run) return
      button.disabled = true
      try {
        await context.run(str(action.run), action.payload ?? {})
        // Replaced by its own confirmation, so it cannot be pressed twice.
        button.replaceWith(text('span', str(action.done) || 'Done', 'ui-muted'))
      } catch (error) {
        button.disabled = false
        button.textContent = error instanceof Error ? error.message : 'That did not work'
      }
    })
    return button
  }

  // A send action types on the visitor's behalf, which keeps the conversation
  // in one place instead of opening a tab.
  button.addEventListener('click', () => context.submit(str(action.send) || label))
  return button
}

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

  const fields = (Array.isArray(data.fields) ? data.fields : []).filter((field) =>
    visible(field as { showIf?: unknown }, data),
  )
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

  const actions = (Array.isArray(data.actions) ? data.actions : []).filter((action) =>
    visible(action as { showIf?: unknown }, data),
  )
  if (actions.length > 0) {
    const row = document.createElement('div')
    row.className = 'ui-actions'
    for (const raw of actions) {
      const node = actionButton(raw as ActionSpec, context)
      if (node) row.appendChild(node)
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
  const items = (Array.isArray(data.items) ? data.items : []).filter((item) =>
    visible(item as { showIf?: unknown }, data),
  )
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
      input?: unknown
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
    } else if (field.input === 'multiline') {
      const area = document.createElement('textarea')
      area.rows = 3
      if (field.placeholder) area.placeholder = str(field.placeholder)
      element = area
    } else {
      const input = document.createElement('input')
      input.type = inputType(field.input, field.type)
      if (field.placeholder) input.placeholder = str(field.placeholder)
      element = input
    }

    element.name = name
    if (field.required !== false && element instanceof HTMLTextAreaElement) element.required = true
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

/**
 * The `type` attribute for a field.
 *
 * An unknown value falls back to text rather than being passed through: these
 * come from a form definition that crossed the wire, and a browser given a
 * type it does not recognise draws a text box anyway. Doing it here means the
 * same thing happens in every browser.
 */
function inputType(input: unknown, type: unknown): string {
  if (input === 'date' || input === 'email' || input === 'tel') return input
  return type === 'number' ? 'number' : 'text'
}
