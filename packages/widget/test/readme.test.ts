import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const embed = readFileSync(join(root, 'src', 'embed.ts'), 'utf8')
const readme = readFileSync(join(root, 'README.md'), 'utf8')

/** `data.inviteDelay` in the script is `data-invite-delay` in the HTML. */
function toAttribute(property: string): string {
  return `data-${property.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)}`
}

/**
 * The script tag is the entire configuration surface for anybody who is not
 * writing TypeScript, and eight of its attributes went undocumented, including
 * the signed identity that stops a visitor claiming to be another customer.
 * Nothing catches that: the code reads one dataset object, so adding an option
 * touches no list anywhere.
 */
describe('the script tag attributes', () => {
  const read = new Set(
    [...embed.matchAll(/\bdata\.([a-zA-Z]+)/g)].map((m) => toAttribute(m[1] as string)),
  )
  const documented = new Set([...readme.matchAll(/data-([a-z-]+)/g)].map((m) => `data-${m[1] as string}`))

  it('are every one of them documented', () => {
    const undocumented = [...read].filter((attribute) => !documented.has(attribute)).sort()
    expect(undocumented, 'attributes the widget reads but the README never mentions').toEqual([])
  })

  it('are none of them invented', () => {
    const invented = [...documented].filter((attribute) => !read.has(attribute)).sort()
    expect(invented, 'attributes the README promises but the widget never reads').toEqual([])
  })

  it('were actually found, rather than the match quietly breaking', () => {
    expect(read.size).toBeGreaterThan(15)
  })
})
