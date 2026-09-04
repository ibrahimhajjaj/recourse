import { defineAction } from '../define.js'
import type { Action, ActionField } from '../types.js'

export interface CustomButtonOptions {
  name?: string
  whenToUse: string
  /**
   * Fixed buttons, or let the agent choose the label and url from a set.
   *
   * `sameTab` sends the customer there in the tab they are already in, instead
   * of opening a new one. Right for a checkout or a sign-in, which are meant to
   * take the whole window; wrong for a reference page, where losing the chat
   * usually means losing the conversation.
   */
  buttons: Array<{ label: string; url: string; sameTab?: boolean }>
  procedureOnly?: boolean
}

/**
 * Shows the customer a button rather than a bare link.
 *
 * The url set is fixed at configuration time and the agent only picks which of
 * them to show. Letting a model compose the destination is how a support widget
 * ends up linking somewhere it should not, on your domain, with your branding
 * around it.
 */
export function customButton(options: CustomButtonOptions): Action {
  const allowed = new Map(options.buttons.map((button) => [button.label, button]))

  return defineAction({
    name: options.name ?? 'show_button',
    whenToUse: options.whenToUse,
    procedureOnly: options.procedureOnly,
    collect: [
      {
        name: 'label',
        type: 'string',
        description: 'Which button to show.',
        options: [...allowed.keys()],
      },
    ],
    async execute(input, ctx) {
      const label = String(input.label ?? '')
      const button = allowed.get(label)
      if (!button) throw new Error(`no button called "${label}"`)

      ctx.emit({
        type: 'ui',
        kind: 'button',
        id: `btn_${label}`,
        data: { label, url: button.url, ...(button.sameTab ? { sameTab: true } : {}) },
      })
      return { shown: label, message: 'The button is displayed. Do not repeat the link as text.' }
    },
  })
}

export interface FormField extends ActionField {
  label: string
  placeholder?: string
  /**
   * The control to draw, where a plain text box is the wrong one.
   *
   * Separate from `type`, which is what the model is told the value is: a date
   * and an email address are both strings to it, and both are the wrong box to
   * put in front of somebody on a phone. `date` gets a picker, `email` and
   * `tel` get the right keyboard and the browser's own checking, `multiline`
   * gets somewhere to describe what happened rather than a single line that
   * scrolls sideways.
   */
  input?: 'text' | 'multiline' | 'email' | 'tel' | 'date'
  /** Lets the customer pick more than one of `options`. */
  multiple?: boolean
  /**
   * Options under headings, for a list long enough that a flat one is a wall:
   * `{ 'North': ['Leeds', 'York'], 'South': ['Bath', 'Exeter'] }`.
   *
   * The model is told the flat set, because a heading is a thing to read
   * rather than a thing to choose, and it only ever picks a value.
   */
  groups?: Record<string, string[]>
  /**
   * A regular expression the answer has to match, as a string.
   *
   * Checked by the browser before the form is sent, so a mistyped postcode is
   * caught while the customer is looking at the box rather than a turn later
   * when the agent asks for it again. Not a substitute for checking on the
   * server: this runs on the customer's machine and can be turned off there.
   */
  pattern?: string
  minLength?: number
  maxLength?: number
  /** For a number field. */
  min?: number
  max?: number
  /**
   * What to say when it does not match.
   *
   * Browsers say "Please match the requested format", which tells nobody what
   * the format is. Say what a good answer looks like.
   */
  invalidMessage?: string
}

export interface CustomFormOptions {
  name: string
  whenToUse: string
  title: string
  fields: FormField[]
  submitLabel?: string
  procedureOnly?: boolean
}

/**
 * Renders a form in the chat instead of asking for six things in a row.
 *
 * Conversational collection is better for two or three fields and worse for
 * six: nobody wants to be interviewed. The form is drawn by the widget and its
 * values come back the same way any client action's do.
 */
export function customForm(options: CustomFormOptions): Action {
  return defineAction({
    name: options.name,
    whenToUse: options.whenToUse,
    procedureOnly: options.procedureOnly,
    runs: 'client',
    collect: [
      {
        name: 'reason',
        type: 'string',
        description: 'One short line telling the customer why you need these details.',
        required: false,
      },
    ],
    // The widget draws it, so the field list travels with the request.
    clientPayload: { form: formSchema(options) },
  })
}

/** The form definition a widget needs in order to draw it. */
export function formSchema(options: CustomFormOptions) {
  return {
    title: options.title,
    submitLabel: options.submitLabel ?? 'Send',
    fields: options.fields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      input: field.input,
      placeholder: field.placeholder,
      required: field.required !== false,
      options: field.groups ? Object.values(field.groups).flat() : field.options,
      groups: field.groups,
      multiple: field.multiple,
      pattern: field.pattern,
      minLength: field.minLength,
      maxLength: field.maxLength,
      min: field.min,
      max: field.max,
      invalidMessage: field.invalidMessage,
    })),
  }
}
