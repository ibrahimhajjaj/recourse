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
})
