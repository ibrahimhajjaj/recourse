import { describe, expect, it } from 'vitest'
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
