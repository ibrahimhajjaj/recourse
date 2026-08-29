/**
 * Every word the widget says, in one place.
 *
 * The widget is the only part of this project a visitor ever reads, and until
 * now most of what it said was written into the markup. A shop in Rotterdam
 * could set the title and the greeting and nothing else, so their Dutch-
 * speaking customers got a Dutch greeting above an English "Type your
 * question", an English "Send", and an English error message when something
 * went wrong.
 *
 * Deliberately not translated by a model. A machine-translated interface that
 * nobody on the team can read is worse than an English one they can: the shop
 * cannot tell whether the button says "Send" or something embarrassing. The
 * host supplies the words.
 */

export interface WidgetStrings {
  /** The header, when no `title` is set. */
  title: string
  /** The launcher's label for a screen reader, and its tooltip. */
  open: string
  close: string
  /** The composer. */
  placeholder: string
  send: string
  inputLabel: string
  /** The attachment control, and the button that takes one back off. */
  attach: string
  /** `{name}` is replaced with the file's name. */
  removeFile: string
  /** Dictation. */
  dictate: string
  stopDictating: string
  /** Under an answer. */
  helpful: string
  notHelpful: string
  thanks: string
  copy: string
  copied: string
  /** The header control that forgets the conversation. */
  deleteConversation: string
  deleteConfirm: string
  /** What a visitor sees when something breaks. */
  offline: string
  rateLimited: string
  unavailable: string
  /** Inline forms the agent renders. */
  submit: string
  submitted: string
  /** The invite bubble's dismiss control. */
  dismiss: string
  /** Under the composer, where a deployment wants a disclosure. */
  footnote?: string
}

/**
 * The English defaults.
 *
 * Written as sentences a support team would actually use, not as interface
 * labels. "Type your question" beats "Message" because it says what to do.
 */
export const DEFAULT_STRINGS: WidgetStrings = {
  title: 'Ask us anything',
  open: 'Open the support chat',
  close: 'Close the support chat',
  placeholder: 'Type your question',
  send: 'Send',
  inputLabel: 'Your question',
  attach: 'Attach a file',
  removeFile: 'Remove {name}',
  dictate: 'Dictate your question',
  stopDictating: 'Stop dictating',
  helpful: 'This helped',
  notHelpful: 'This did not help',
  thanks: 'Thanks, that helps us improve.',
  copy: 'Copy this answer',
  copied: 'Copied',
  deleteConversation: 'Delete this conversation',
  deleteConfirm: 'Delete this conversation? It cannot be brought back.',
  offline: 'Could not reach the assistant. Check your connection.',
  rateLimited: 'Too many messages just now. Give it a moment.',
  unavailable: 'The assistant is unavailable ({status}).',
  submit: 'Send',
  submitted: 'Thanks, sending that now.',
  dismiss: 'Dismiss',
}

/**
 * The host's words over the defaults.
 *
 * A partial set is normal and supported: a shop translating the three strings
 * a customer reads most should not have to supply the other twenty.
 */
export function resolveStrings(overrides?: Partial<WidgetStrings>): WidgetStrings {
  if (!overrides) return DEFAULT_STRINGS

  const resolved = { ...DEFAULT_STRINGS }

  for (const [key, value] of Object.entries(overrides)) {
    // Anything that is not a usable string is ignored rather than rendered.
    // These arrive from a data attribute or a global on somebody's page, and
    // an empty label is a control a screen reader cannot announce.
    if (typeof value === 'string' && value.trim().length > 0) {
      resolved[key as keyof WidgetStrings] = value
    }
  }

  return resolved
}

/** Fills `{name}` style placeholders. Leaves an unknown one alone. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  )
}
