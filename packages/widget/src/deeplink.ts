/**
 * Opening the widget on a question somebody linked to.
 *
 * A help article that ends "still stuck?" can only offer a mailto or a link to
 * a contact form. With this it can link to the answer instead:
 *
 *     <a href="/billing?helpdeck_q=How+do+I+change+my+VAT+number">ask about VAT</a>
 *
 * The visitor lands on the page they were going to anyway, the panel opens,
 * and the question is already being answered. It also gives support staff a
 * link to paste into an email, and gives a docs site a way to find out which
 * paragraphs send people to the chat.
 */

/** Read in this order. The namespaced one is canonical; `hd_q` is for hand-typed links. */
export const DEEP_LINK_PARAMS = ['helpdeck_q', 'hd_q'] as const

/**
 * Long enough for a real question, short enough that a crafted link cannot
 * push a wall of text into the agent's context.
 */
const MAX_LENGTH = 1000

export interface DeepLinkOptions {
  /** Replaces {@link DEEP_LINK_PARAMS}, for a deployment that wants its own name. */
  params?: readonly string[]
  /** Defaults to `window.location.href`. */
  href?: string
  /**
   * Removes the parameter from the address bar once it has been read.
   *
   * On by default and close to required: without it a refresh asks again, the
   * customer's back button asks again, and the question stays in the URL they
   * copy to somebody else.
   */
  strip?: boolean
}

/**
 * The question a link is carrying, and nothing else.
 *
 * Deliberately not `q`. That parameter is already a site search on half the
 * web, and reading it would have the widget answer a question the visitor
 * asked of something else entirely.
 */
export function readDeepLink(options: DeepLinkOptions = {}): string | null {
  const names = options.params ?? DEEP_LINK_PARAMS

  let url: URL
  try {
    url = new URL(options.href ?? window.location.href)
  } catch {
    // A document with no usable location, such as a sandboxed frame.
    return null
  }

  let question: string | null = null
  for (const name of names) {
    const value = url.searchParams.get(name)
    if (value && value.trim()) {
      question = value.trim().slice(0, MAX_LENGTH)
      break
    }
  }

  if (question === null) return null

  if (options.strip !== false) {
    for (const name of names) url.searchParams.delete(name)

    try {
      // `replaceState` rather than pushState: the URL with the question in it
      // is not a place the back button should return to.
      window.history.replaceState(window.history.state, '', url.toString())
    } catch {
      // Cross-origin or a browser that refuses. The question still gets asked;
      // it will simply be asked again on a refresh.
    }
  }

  return question
}

export interface DeepLinkTarget {
  open(): void
  ask(question: string): void | Promise<void>
}

/**
 * Opens the widget on the linked question, if there is one.
 *
 * Returns what it asked, so a caller can log which articles send people here.
 */
export function openDeepLink(widget: DeepLinkTarget, options: DeepLinkOptions = {}): string | null {
  const question = readDeepLink(options)
  if (question === null) return null

  widget.open()
  void widget.ask(question)
  return question
}
