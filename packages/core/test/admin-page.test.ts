// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_PAGE } from '../src/api/admin.js'

/**
 * The admin page is a browser program living inside a template literal, which
 * is a place a compiler does not look. A `\n` written where `\\n` was meant
 * becomes a real newline in the middle of a string and the page goes blank,
 * behind an auth token, where nothing else in this suite would ever see it.
 */
function browserScript(): string {
  const opening = '<script type="module">'
  const from = ADMIN_PAGE.indexOf(opening)
  expect(from, 'the page has no module script').toBeGreaterThan(-1)

  return ADMIN_PAGE.slice(from + opening.length, ADMIN_PAGE.lastIndexOf('</script>'))
}

describe('the admin page', () => {
  it('is a program a browser can parse', () => {
    const script = browserScript()

    // Parsed, not run: `new Function` compiles the whole body and throws on a
    // syntax error, which is the failure being guarded against. It works here
    // because the page imports nothing statically.
    expect(() => new Function(script)).not.toThrow()
    expect(script.length).toBeGreaterThan(2000)
  })

  it('escapes its newlines, which is how that breaks', () => {
    const script = browserScript()

    // A bare newline inside a single-quoted string is the exact bug: the TS
    // template literal turns `\n` into one before the browser ever sees it.
    for (const [line] of script.matchAll(/^.*'[^']*$/gm)) {
      expect(line.includes("'"), `unterminated string: ${line.trim().slice(0, 60)}`).toBe(true)
    }
  })

  it('offers every view its nav promises', () => {
    const script = browserScript()

    for (const [, name] of ADMIN_PAGE.matchAll(/data-view="([a-z]+)"/g)) {
      expect(script, `nav offers ${name} with no view behind it`).toContain(`async ${name}(`)
    }
  })

  it('sends the credential from one place, so no call can forget it', () => {
    const script = browserScript()

    // One `fetch` in the whole page. Two call sites were two chances to leave
    // the header off, and the symptom is a panel that renders empty.
    expect(script.match(/\bfetch\(/g) ?? []).toHaveLength(1)
    expect(script).toContain("headers.authorization = 'Bearer ' + token")
    expect(script).toContain("new URLSearchParams(location.search).get('token')")
    // The preview is a navigation, so it needs the token in its URL.
    expect(script).toContain("asked.set('token', token)")
  })
})

describe('the page a support lead actually uses', () => {
  it('parses, so a typo is caught here and not by them', () => {
    const script = ADMIN_PAGE.slice(
      ADMIN_PAGE.indexOf('<script type="module">') + '<script type="module">'.length,
      ADMIN_PAGE.lastIndexOf('</script>'),
    )

    // Compiled, never run: there is no document here and running it would prove
    // nothing anyway. Nothing else checks this at all. The page is a template
    // string, so an unbalanced bracket ships happily and fails for the first
    // person who opens it.
    //
    // Wrapped in an async function because the script uses top-level await,
    // which is legal in a module and not in a bare function body.
    expect(() => new Function(`return (async () => {${script}})`)).not.toThrow()
  })

  it('can write, not only read', () => {
    // The whole reason a read-only page was not enough: the person who spots a
    // wrong answer has to be able to fix it here.
    expect(ADMIN_PAGE).toContain("data-view=\"corrections\"")
    expect(ADMIN_PAGE).toContain("send('/corrections', 'POST'")
    expect(ADMIN_PAGE).toContain("send('/corrections/' + correction.id, 'DELETE')")
  })

  it('turns a failed question into a correction in one click', () => {
    // Two disconnected screens would be a list of problems and a form. The
    // button is what makes it a loop.
    expect(ADMIN_PAGE).toContain("show('corrections', { question: gap.question })")
  })
})

/** One request the page made, as the stubbed server saw it. */
interface Recorded {
  method: string
  path: string
  body: unknown
}

/** The pieces of the page a test can drive once the script has run. */
interface Running {
  show: (name: string, prefill?: unknown) => Promise<void>
  views: { corrections: (prefill?: unknown) => Promise<HTMLElement> }
  send: (path: string, method: string, body?: unknown) => Promise<unknown>
}

const STORED = { id: 'c1', question: 'where is my order', answer: 'check the tracking link', author: 'sam' }

/**
 * What the API mounts, and nothing else.
 *
 * The table is the routes in `src/api/index.ts`. A path the page asks for that
 * is not one of them answers 404 here, which is the failure this whole block
 * exists to catch: a page that calls a route nobody serves.
 */
function answerFor(path: string, method: string): { status: number; body: unknown } {
  if (method === 'DELETE' && /\/corrections\/[^/]+$/.test(path)) return { status: 200, body: { data: { removed: true } } }
  if (method === 'POST' && path.endsWith('/corrections')) return { status: 201, body: { data: { id: 'c2' } } }
  if (path.endsWith('/stats')) {
    return {
      status: 200,
      body: { data: { conversations: 3, messages: 9, unanswered: 1, leads: 0, thumbsUp: 2, thumbsDown: 1 } },
    }
  }
  if (path.includes('/conversations')) return { status: 200, body: { data: [] } }
  if (path.endsWith('/corrections')) return { status: 200, body: { data: [STORED] } }

  return { status: 404, body: { error: { message: `nothing serves ${method} ${path}` } } }
}

/** Lets every chained handler in the page finish before anything is asserted. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Runs the page and hands back the parts a test drives. */
async function open(calls: Recorded[]): Promise<Running> {
  vi.stubGlobal('fetch', async (url: unknown, init: RequestInit = {}) => {
    const path = String(url)
    const method = init.method ?? 'GET'
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined })

    const { status, body } = answerFor(path, method)
    return { ok: status < 400, status, json: async () => body }
  })

  // The nav is read on load and the two containers are written to, so without
  // them the script throws before it has asked for anything.
  const nav = [...ADMIN_PAGE.matchAll(/data-view="([a-z]+)"/g)]
    .map(([, view]) => `<button data-view="${view ?? ''}"></button>`)
    .join('')
  document.body.innerHTML =
    `<header><nav>${nav}</nav></header>` +
    '<main><div class="stats" id="stats"></div><div id="view"></div></main>'

  const script = browserScript()

  // Run, not parsed: the tests above already prove it compiles. Wrapped in an
  // async function because the body ends in calls it does not await, and
  // returning the three names is the only way to reach them from out here.
  const factory = new Function(`return (async () => {${script}\nreturn { show, views, send } })()`)

  return (await factory()) as Running
}

describe('the admin page against the routes it is served beside', () => {
  let calls: Recorded[]

  beforeEach(() => {
    calls = []
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for the two things it shows on load, and nothing else', async () => {
    await open(calls)
    await settle()

    expect(calls).toHaveLength(2)
    // Compared by their tail: `base` comes off `location.pathname`, so the
    // prefix here is whatever this environment's document URL happens to be,
    // and an exact match would break the moment it is served from a real path.
    expect(calls[0]?.path.endsWith('/stats')).toBe(true)
    expect(calls[1]?.path.endsWith('/conversations?limit=50')).toBe(true)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('lists the corrections the server already has', async () => {
    const { views } = await open(calls)
    await settle()

    const panel = await views.corrections({})

    expect(panel.textContent).toContain(STORED.question)
    expect(panel.textContent).toContain(STORED.answer)
    expect(panel.textContent).toContain(STORED.author)
    expect(calls.some((call) => call.method === 'GET' && call.path.endsWith('/corrections'))).toBe(true)
  })

  it('posts a new correction in the shape the route reads', async () => {
    const { views } = await open(calls)
    await settle()

    const panel = await views.corrections({})
    const fields = Array.from(panel.querySelectorAll('textarea'))
    const question = fields[0]
    const answer = fields[1]
    const form = panel.querySelector('form')
    if (!question || !answer || !form) throw new Error('the corrections form is missing its fields')

    question.value = '  how do I cancel  '
    answer.value = '  from the orders page  '
    calls.length = 0
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle()

    const posted = calls.find((call) => call.method === 'POST')

    expect(posted?.path.endsWith('/corrections')).toBe(true)
    // The route reads exactly these two keys off the body and refuses a blank
    // one, so an untrimmed value here would be saved as a question nothing matches.
    expect(posted?.body).toEqual({ question: 'how do I cancel', answer: 'from the orders page' })
  })

  it('deletes the row whose Remove button was pressed', async () => {
    const { views } = await open(calls)
    await settle()

    const panel = await views.corrections({})
    const remove = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent === 'Remove')
    if (!remove) throw new Error('the corrections list has no Remove button')

    calls.length = 0
    remove.click()
    await settle()

    const deleted = calls.find((call) => call.method === 'DELETE')

    expect(deleted?.path.endsWith(`/corrections/${STORED.id}`)).toBe(true)
  })

  it('never asks for a route the api does not mount', async () => {
    const { views } = await open(calls)
    await settle()

    const panel = await views.corrections({})
    const remove = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent === 'Remove')
    remove?.click()
    await settle()

    const unserved = calls.filter((call) => answerFor(call.path, call.method).status === 404)

    expect(unserved.map((call) => `${call.method} ${call.path}`)).toEqual([])
  })
})
