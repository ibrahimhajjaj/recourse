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

describe('form fields that are not a text box', () => {
  const draw = (field: Record<string, unknown>) => {
    const form = renderForm(
      { title: 'Warranty claim', submitLabel: 'Send', fields: [{ name: 'x', label: 'X', type: 'string', ...field }] },
      context(),
    )
    return form.querySelector('.ui-field input, .ui-field textarea, .ui-field select') as HTMLElement
  }

  it('draws a picker for a date and the right keyboard for an address or a number', () => {
    // All strings to the model, all the wrong box in front of somebody on a
    // phone, which is why the control is named separately from the type.
    expect((draw({ input: 'date' }) as HTMLInputElement).type).toBe('date')
    expect((draw({ input: 'email' }) as HTMLInputElement).type).toBe('email')
    expect((draw({ input: 'tel' }) as HTMLInputElement).type).toBe('tel')
  })

  it('gives somewhere to describe what happened', () => {
    const area = draw({ input: 'multiline' }) as HTMLTextAreaElement
    expect(area.tagName).toBe('TEXTAREA')
    expect(area.required).toBe(true)
  })

  it('falls back to a text box for anything it does not know', () => {
    expect((draw({ input: 'colour-wheel' }) as HTMLInputElement).type).toBe('text')
    expect((draw({}) as HTMLInputElement).type).toBe('text')
    expect((draw({ type: 'number' }) as HTMLInputElement).type).toBe('number')
  })

  it('still prefers a dropdown when the field lists its options', () => {
    expect(draw({ input: 'date', options: ['Yes', 'No'] }).tagName).toBe('SELECT')
  })
})

describe('what a form will not accept', () => {
  const build = (field: Record<string, unknown>) => {
    const ctx = context()
    const form = renderForm(
      { title: 'Warranty claim', submitLabel: 'Send', fields: [{ name: 'x', label: 'X', type: 'string', ...field }] },
      ctx,
    )
    const control = form.querySelector('.ui-field input, .ui-field textarea, .ui-field select') as HTMLElement
    return { form, control, ctx }
  }

  it('puts the constraints on the control, so the browser refuses before we do', () => {
    const { control } = build({ pattern: '^[A-Z]{2}\\d{2}', minLength: 4, maxLength: 8 })
    const input = control as HTMLInputElement

    expect(input.pattern).toBe('^[A-Z]{2}\\d{2}')
    expect(input.minLength).toBe(4)
    expect(input.maxLength).toBe(8)
  })

  it('bounds a number rather than a string', () => {
    const { control } = build({ type: 'number', min: 1, max: 9 })

    expect((control as HTMLInputElement).min).toBe('1')
    expect((control as HTMLInputElement).max).toBe('9')
  })

  it('says what a good answer looks like instead of the browser’s own wording', () => {
    const { control } = build({ pattern: '^[A-Z]{2}\\d{2}', invalidMessage: 'Like SW1A 1AA.' })
    const input = control as HTMLInputElement

    input.value = 'nope'
    input.dispatchEvent(new Event('invalid'))
    expect(input.validationMessage).toBe('Like SW1A 1AA.')

    // Cleared on the next edit, or the first refusal sticks to a fixed value.
    input.value = 'SW11'
    input.dispatchEvent(new Event('input'))
    expect(input.validationMessage).toBe('')
  })
})

describe('picking more than one, and picking from headings', () => {
  const build = (field: Record<string, unknown>) => {
    const ctx = context()
    const form = renderForm(
      { title: 'Where', submitLabel: 'Send', fields: [{ name: 'where', label: 'Where', type: 'string', ...field }] },
      ctx,
    )
    return { form, select: form.querySelector('select') as HTMLSelectElement, ctx }
  }

  it('groups the options under their headings', () => {
    const { select } = build({ groups: { North: ['Leeds', 'York'], South: ['Bath'] } })

    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['North', 'South'])
    expect(select.querySelectorAll('option')).toHaveLength(3)
  })

  it('ignores a group with nothing in it', () => {
    const { select } = build({ groups: { North: ['Leeds'], South: [] } })

    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['North'])
  })

  it('returns every choice from a multiple select, and one from a single', () => {
    const many = build({ options: ['Leeds', 'York', 'Bath'], multiple: true })
    for (const chosen of [...many.select.options].filter((o) => o.value !== 'York')) chosen.selected = true
    many.form.dispatchEvent(new Event('submit', { cancelable: true }))

    expect(many.ctx.responded[0]).toEqual({ where: ['Leeds', 'Bath'] })

    const one = build({ options: ['Leeds', 'York'] })
    one.select.value = 'York'
    one.form.dispatchEvent(new Event('submit', { cancelable: true }))

    expect(one.ctx.responded[0]).toEqual({ where: 'York' })
  })
})

describe('a chart', () => {
  const draw = (data: Record<string, unknown>) => render('chart', data).node

  it('draws a bar and the number beside it for each point', () => {
    const node = draw({
      title: 'Spend per month',
      points: [
        { label: 'June', value: 40, display: '£40' },
        { label: 'July', value: 80, display: '£80' },
      ],
    })

    expect(node?.querySelector('h3')?.textContent).toBe('Spend per month')
    expect(node?.querySelectorAll('.ui-chart-bar')).toHaveLength(2)
    // Read off the page, not guessed from the length. A bar chart nobody can
    // read the values off is a picture of a table.
    expect(node?.textContent).toContain('£40')
    expect(node?.textContent).toContain('£80')
  })

  it('scales against the largest bar, from zero', () => {
    // Starting the scale at the smallest value makes a 2% gap look total,
    // which is the oldest way to mislead with a chart.
    const node = draw({
      points: [
        { label: 'June', value: 98 },
        { label: 'July', value: 100 },
      ],
    })

    const bars = [...(node?.querySelectorAll('.ui-chart-bar') ?? [])] as HTMLElement[]
    expect(bars[0]?.style.width).toBe('98%')
    expect(bars[1]?.style.width).toBe('100%')
  })

  it('falls back to the raw number when nothing formatted it', () => {
    expect(draw({ points: [{ label: 'June', value: 40 }] })?.textContent).toContain('40')
  })

  it('drops points that are not numbers, and draws nothing at all if none are', () => {
    const node = draw({
      points: [
        { label: 'June', value: 'lots' },
        { label: 'July', value: 3 },
      ],
    })

    expect(node?.querySelectorAll('.ui-chart-bar')).toHaveLength(1)
    expect(draw({ points: [{ label: 'June', value: 'lots' }] })).toBeNull()
    expect(draw({})).toBeNull()
  })

  it('survives every value being zero', () => {
    const node = draw({ points: [{ label: 'June', value: 0 }] })

    expect((node?.querySelector('.ui-chart-bar') as HTMLElement).style.width).toBe('0%')
  })
})
