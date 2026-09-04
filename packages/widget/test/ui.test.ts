import { describe, expect, it } from 'vitest'
import { renderForm, renderUi } from '../src/ui.js'

function context() {
  const submitted: string[] = []
  const responded: Record<string, unknown>[] = []
  return {
    submitted,
    responded,
    submit: (text: string) => void submitted.push(text),
    respond: (values: Record<string, unknown>) => void responded.push(values),
  }
}

function render(kind: string, data: Record<string, unknown>) {
  const ctx = context()
  return { node: renderUi({ kind, id: 'x', data }, ctx), ctx }
}

describe('cards', () => {
  it('renders a title, fields and a link action', () => {
    const { node } = render('card', {
      title: 'Order #1001',
      subtitle: 'Delivered 20 August',
      fields: [{ label: 'Status', value: 'Delivered' }],
      actions: [{ label: 'Track', url: 'https://track.example/1' }],
    })

    expect(node?.querySelector('h3')?.textContent).toBe('Order #1001')
    expect(node?.querySelector('dt')?.textContent).toBe('Status')
    expect(node?.querySelector('a')?.getAttribute('href')).toBe('https://track.example/1')
    expect(node?.querySelector('a')?.rel).toBe('noopener noreferrer')
  })

  it('types on the visitor’s behalf for a send action', () => {
    const ctx = context()
    const node = renderUi(
      { kind: 'card', id: 'x', data: { title: 'T', actions: [{ label: 'Yes please', send: 'yes please' }] } },
      ctx,
    )
    node?.querySelector('button')?.click()
    expect(ctx.submitted).toEqual(['yes please'])
  })

  it('renders a javascript: action as inert text rather than a link', () => {
    const { node } = render('card', {
      title: 'T',
      actions: [{ label: 'Click', url: 'javascript:alert(1)' }],
    })
    expect(node?.querySelector('a')).toBeNull()
    expect(node?.textContent).toContain('Click')
  })

  it('ignores an image whose source is not a url we would open', () => {
    const { node } = render('card', { title: 'T', image: 'javascript:alert(1)' })
    expect(node?.querySelector('img')).toBeNull()
  })
})

describe('tables', () => {
  it('renders headers and rows from objects', () => {
    const { node } = render('table', {
      columns: ['Destination', 'Time'],
      rows: [{ Destination: 'UK', Time: '1 to 2 days' }],
    })
    expect(node?.querySelectorAll('th')).toHaveLength(2)
    expect(node?.querySelector('td')?.textContent).toBe('UK')
  })

  it('renders rows given as arrays', () => {
    const { node } = render('table', { columns: ['A', 'B'], rows: [['1', '2']] })
    expect(node?.querySelectorAll('td')).toHaveLength(2)
  })

  it('caps a long table rather than filling the panel', () => {
    const rows = Array.from({ length: 60 }, (_, i) => [String(i)])
    const { node } = render('table', { columns: ['N'], rows })
    expect(node?.querySelectorAll('tbody tr').length).toBe(25)
  })

  it('renders nothing when there is nothing to show', () => {
    expect(render('table', { columns: [], rows: [] }).node).toBeNull()
  })
})

describe('lists', () => {
  it('sends the item text when one is chosen', () => {
    const ctx = context()
    const node = renderUi(
      { kind: 'list', id: 'x', data: { items: [{ title: 'Ethiopia Guji', subtitle: '250g' }] } },
      ctx,
    )
    node?.querySelector('button')?.click()
    expect(ctx.submitted).toEqual(['Ethiopia Guji'])
  })

  it('links out when an item has a url', () => {
    const { node } = render('list', { items: [{ title: 'Help', url: 'https://shop.example/help' }] })
    expect(node?.querySelector('a')?.target).toBe('_blank')
  })
})

describe('unknown components', () => {
  it('renders nothing rather than guessing', () => {
    expect(render('hologram', { anything: true }).node).toBeNull()
  })
})

describe('forms', () => {
  const definition = {
    title: 'Warranty claim',
    submitLabel: 'Submit claim',
    fields: [
      { name: 'serial', label: 'Serial number', type: 'string', required: true },
      { name: 'model', label: 'Model', type: 'string', options: ['V60', 'Chemex'] },
      { name: 'gift', label: 'Was it a gift?', type: 'boolean', required: false },
    ],
  }

  it('draws an input, a select and a checkbox', () => {
    const ctx = context()
    const form = renderForm(definition, ctx)

    expect(form.querySelector('h3')?.textContent).toBe('Warranty claim')
    expect(form.querySelector('input[name="serial"]')).not.toBeNull()
    expect(form.querySelectorAll('select[name="model"] option')).toHaveLength(2)
    expect(form.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Submit claim')
  })

  it('returns the values when submitted', () => {
    const ctx = context()
    const form = renderForm(definition, ctx)
    document.body.appendChild(form)

    ;(form.querySelector('input[name="serial"]') as HTMLInputElement).value = 'AB-1'
    ;(form.querySelector('select[name="model"]') as HTMLSelectElement).value = 'Chemex'
    ;(form.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = true

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))

    expect(ctx.responded[0]).toEqual({ serial: 'AB-1', model: 'Chemex', gift: true })
    form.remove()
  })

  it('replaces itself after submitting, so nobody sends it twice', () => {
    const ctx = context()
    const form = renderForm(definition, ctx)
    document.body.appendChild(form)

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))

    expect(ctx.responded).toHaveLength(1)
    expect(form.querySelector('input')).toBeNull()
    form.remove()
  })

  it('marks fields required unless they say otherwise', () => {
    const form = renderForm(definition, context())
    expect((form.querySelector('input[name="serial"]') as HTMLInputElement).required).toBe(true)
  })

  it('skips a field with no name, which could never be submitted', () => {
    const form = renderForm({ fields: [{ label: 'Nameless', type: 'string' }] }, context())
    expect(form.querySelectorAll('input')).toHaveLength(0)
  })
})

describe('conditional visibility', () => {
  it('hides a field whose condition is false', () => {
    const { node } = render('card', {
      title: 'Order',
      shipped: false,
      fields: [
        { label: 'Status', value: 'Preparing' },
        { label: 'Tracking', value: 'AB123', showIf: 'shipped' },
      ],
    })
    expect([...(node?.querySelectorAll('dt') ?? [])].map((d) => d.textContent)).toEqual(['Status'])
  })

  it('shows it once the condition holds', () => {
    const { node } = render('card', {
      title: 'Order',
      shipped: true,
      fields: [{ label: 'Tracking', value: 'AB123', showIf: 'shipped' }],
    })
    expect(node?.querySelector('dt')?.textContent).toBe('Tracking')
  })

  it('supports negation and comparison', () => {
    // "!shipped" hides the chase-it row once the order has actually shipped.
    const hidden = render('card', {
      title: 'T',
      shipped: true,
      fields: [{ label: 'Chase it', value: 'x', showIf: '!shipped' }],
    })
    expect(hidden.node?.querySelector('dt')).toBeNull()

    const shown = render('card', {
      title: 'T',
      status: 'shipped',
      fields: [{ label: 'Delivered', value: 'x', showIf: 'status=shipped' }],
    })
    expect(shown.node?.querySelector('dt')?.textContent).toBe('Delivered')
  })

  it('shows anything with no condition at all', () => {
    const { node } = render('card', { title: 'T', fields: [{ label: 'Always', value: 'x' }] })
    expect(node?.querySelector('dt')?.textContent).toBe('Always')
  })

  it('hides a whole action', () => {
    const { node } = render('card', {
      title: 'T',
      cancellable: false,
      actions: [{ label: 'Cancel', run: 'cancel', showIf: 'cancellable' }],
    })
    expect(node?.querySelector('button')).toBeNull()
  })
})

describe('element functions', () => {
  function withRun(handler: (name: string, payload: Record<string, unknown>) => Promise<unknown>) {
    const ctx = {
      submitted: [] as string[],
      responded: [] as Record<string, unknown>[],
      submit: (t: string) => void ctx.submitted.push(t),
      respond: (v: Record<string, unknown>) => void ctx.responded.push(v),
      run: handler,
    }
    return ctx
  }

  it('calls the registered handler without going back through the model', async () => {
    const calls: Array<{ name: string; payload: unknown }> = []
    const ctx = withRun(async (name, payload) => {
      calls.push({ name, payload })
      return { ok: true }
    })

    const node = renderUi(
      {
        kind: 'card',
        id: 'x',
        data: { title: 'Booking', actions: [{ label: 'Cancel', run: 'cancel_booking', payload: { id: 7 } }] },
      },
      ctx,
    )

    node?.querySelector('button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(calls).toEqual([{ name: 'cancel_booking', payload: { id: 7 } }])
    // Nothing was typed on the visitor's behalf.
    expect(ctx.submitted).toEqual([])
  })

  it('replaces the button once it has run, so it cannot fire twice', async () => {
    const ctx = withRun(async () => ({ ok: true }))
    const node = renderUi(
      { kind: 'card', id: 'x', data: { title: 'T', actions: [{ label: 'Cancel', run: 'cancel', done: 'Cancelled' }] } },
      ctx,
    )

    node?.querySelector('button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(node?.querySelector('button')).toBeNull()
    expect(node?.textContent).toContain('Cancelled')
  })

  it('shows the failure and lets them try again', async () => {
    const ctx = withRun(async () => {
      throw new Error('Booking already cancelled')
    })

    const node = renderUi(
      { kind: 'card', id: 'x', data: { title: 'T', actions: [{ label: 'Cancel', run: 'cancel' }] } },
      ctx,
    )

    node?.querySelector('button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 10))

    const button = node?.querySelector('button') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Booking already cancelled')
  })
})

describe('buttons', () => {
  it('opens a new tab by default and takes the current one when told to', () => {
    const away = render('button', { label: 'Read the policy', url: 'https://shop.example/policy' })
    const here = render('button', { label: 'Pay now', url: 'https://shop.example/pay', sameTab: true })

    expect(away.node?.querySelector('a')?.getAttribute('target')).toBe('_blank')
    expect(here.node?.querySelector('a')?.getAttribute('target')).toBeNull()
    // Kept in both cases: the tab it lands in changes, the isolation does not.
    expect(here.node?.querySelector('a')?.rel).toBe('noopener noreferrer')
  })
})
