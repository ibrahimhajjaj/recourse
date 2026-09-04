import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidget } from '../src/widget.js'
import { DEFAULT_STRINGS } from '../src/strings.js'

/**
 * Asking the same question again, after an answer that was no good.
 *
 * The alternative for a customer given a bad answer is retyping the question
 * or leaving, and both look the same from here.
 */

function mount(over: Record<string, unknown> = {}) {
  const target = document.createElement('div')
  document.body.appendChild(target)

  createWidget({ endpoint: 'https://example.com/api/chat', target, open: true, persist: false, ...over })

  return target.querySelector('div')?.shadowRoot as ShadowRoot
}

/** Each call answers with the next line, recording what it was sent. */
function stub(answers: string[]) {
  const sent: Array<{ messages: Array<{ role: string; content: string }>; retry?: boolean }> = []
  let at = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)))
      const answer = answers[Math.min(at++, answers.length - 1)]
      return new Response(
        `data: ${JSON.stringify({ type: 'delta', text: answer })}\n\ndata: {"type":"done"}\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }),
  )

  return sent
}

const settle = async () => {
  for (let tick = 0; tick < 60; tick++) await new Promise((resolve) => setTimeout(resolve, 5))
}

async function ask(root: ShadowRoot, text = 'do you do refunds?') {
  ;(root.querySelector('textarea') as HTMLTextAreaElement).value = text
  ;(root.querySelector('form.composer') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))
  await settle()
}

const retryButton = (root: ShadowRoot) =>
  root.querySelector(`[aria-label="${DEFAULT_STRINGS.retry}"]`) as HTMLButtonElement | null

beforeEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('trying again', () => {
  it('replaces the answer rather than adding a second one', async () => {
    const root = mount()
    stub(['Not really.', 'Yes, within 30 days.'])
    await ask(root)

    expect(root.textContent).toContain('Not really.')
    retryButton(root)?.click()
    await settle()

    expect(root.textContent).toContain('Yes, within 30 days.')
    expect(root.textContent).not.toContain('Not really.')
  })

  it('sends the history ending at the question, so the model starts clean', async () => {
    // Not "improve on your own reply": the rejected answer is dropped from
    // what the model sees, or it anchors on it.
    const root = mount()
    const sent = stub(['Not really.', 'Yes, within 30 days.'])
    await ask(root)

    retryButton(root)?.click()
    await settle()

    expect(sent[1]?.messages.map((m) => m.content)).toEqual(['do you do refunds?'])
    expect(sent[1]?.retry).toBe(true)
  })

  it('marks only the retry, so an ordinary turn is still a new question', async () => {
    const root = mount()
    const sent = stub(['Not really.'])
    await ask(root)

    expect(sent[0]).not.toHaveProperty('retry')
  })

  it('offers it on the newest answer only', async () => {
    // Regenerating one in the middle leaves the rest of the conversation
    // replying to something that is no longer there.
    const root = mount()
    stub(['First answer.', 'Second answer.'])
    await ask(root)
    await ask(root, 'and to Ireland?')

    expect(root.querySelectorAll(`[aria-label="${DEFAULT_STRINGS.retry}"]`)).toHaveLength(1)
  })

  it('can be turned off', async () => {
    const root = mount({ retry: false })
    stub(['Not really.'])
    await ask(root)

    expect(retryButton(root)).toBeNull()
  })
})
