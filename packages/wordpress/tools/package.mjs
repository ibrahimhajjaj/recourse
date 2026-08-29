/**
 * Builds the directory that ships, and nothing else.
 *
 * Plugin Check reads whatever is in the plugin folder, and a repository has a
 * great deal in it that a plugin folder must not: a composer manifest, a test
 * suite, a PHPUnit config, dotfiles. Every one of those is an error on the
 * scanner, and shipping them is also how a plugin ends up with a readable
 * `.git` directory on somebody's server.
 *
 * So the zip is built from an allowlist. A file that is not named here does not
 * ship, which is the safe direction to fail in.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'helpdeck')

/** Everything the plugin needs at runtime, and nothing else. */
const SHIPS = [
  'helpdeck.php',
  'uninstall.php',
  'readme.txt',
  'includes',
  'assets',
  'languages',
]

if (!existsSync(join(root, 'assets', 'helpdeck.min.js'))) {
  console.error('The widget is not built. Run `npm run build` first.')
  process.exit(1)
}

rmSync(join(root, 'dist'), { recursive: true, force: true })
mkdirSync(out, { recursive: true })

for (const entry of SHIPS) {
  const from = join(root, entry)

  if (!existsSync(from)) {
    console.error(`Missing: ${entry}`)
    process.exit(1)
  }

  cpSync(from, join(out, entry), {
    recursive: true,
    // A dotfile inside a shipped folder is still a dotfile the scanner will
    // find, so the filter applies at every level rather than only the top.
    filter: (source) => !source.split('/').some((part) => part.startsWith('.')),
  })
}

let files = 0
let bytes = 0

const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path)
    else {
      files++
      bytes += statSync(path).size
    }
  }
}

walk(out)

const zip = spawnSync('zip', ['-rq', 'helpdeck.zip', 'helpdeck'], {
  cwd: join(root, 'dist'),
})

console.log(`dist/helpdeck: ${files} files, ${(bytes / 1024).toFixed(0)} KB`)

if (zip.status === 0) {
  console.log(`dist/helpdeck.zip: ${(statSync(join(root, 'dist', 'helpdeck.zip')).size / 1024).toFixed(0)} KB`)
}
