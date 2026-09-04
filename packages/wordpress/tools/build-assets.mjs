/**
 * Copies the widget build into the plugin.
 *
 * Both files, minified and not. The directory's guidelines require the source
 * of anything compiled to be available: either in the zip or linked from the
 * readme. Shipping the readable file next to the minified one costs 30KB and
 * answers the question before it is asked.
 *
 * From `dist/wordpress` rather than `dist`, which is the same widget compiled
 * without the loader that pulls a voice runtime from a CDN. A plugin may not
 * fetch code from a remote host, and the general build names one.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const built = join(root, '..', 'widget', 'dist', 'wordpress')
const assets = join(root, 'assets')

if (!existsSync(join(built, 'recourse.min.js'))) {
  console.error('No WordPress widget build found. Run `pnpm --filter @recourse-ai/widget build` first.')
  process.exit(1)
}

/**
 * A build older than the source it came from.
 *
 * This copies whatever is sitting in the widget's dist, so editing the widget
 * and packaging the plugin without rebuilding ships the previous version into
 * the zip. Nothing about that looks wrong: the file is present, the sizes are
 * plausible, and the difference only shows up in a browser somebody else is
 * using.
 */
function newestSource(directory) {
  let newest = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestSource(path) : statSync(path).mtimeMs)
  }
  return newest
}

const source = join(root, '..', 'widget', 'src')
if (existsSync(source) && newestSource(source) > statSync(join(built, 'recourse.min.js')).mtimeMs) {
  console.error('The widget build is older than the widget source.')
  console.error('Run `pnpm --filter @recourse-ai/widget build` first, or the plugin ships the previous version.')
  process.exit(1)
}

mkdirSync(assets, { recursive: true })

/** The widget builds, which this script owns and overwrites every run. */
const GENERATED = ['recourse.js', 'recourse.min.js']

/** Authored by hand and left alone, whatever their extension. */
const AUTHORED = ['admin.css', 'admin.js']

// Remove any bundle already here before copying the current one in. Copying
// over a fixed set of names leaves anything under a previous name untouched,
// and the plugin zip then ships both: a reviewer sees two copies of the widget
// under two names, one matching no code in the plugin.
//
// Matched against the authored list rather than by extension. Deleting every
// `.js` took the admin script with it, and the failure was quiet: the file
// vanished from the working tree, the zip shipped without it, and the settings
// screen enqueued a URL that was not there.
for (const stale of readdirSync(assets)) {
  if (AUTHORED.includes(stale)) continue
  if (stale.endsWith('.js')) rmSync(join(assets, stale))
}

for (const file of GENERATED) {
  copyFileSync(join(built, file), join(assets, file))
  console.log(`  ${file}  ${(statSync(join(assets, file)).size / 1024).toFixed(1)} KB`)
}

// Checked here as well as in the widget's own build, because this is the step
// that decides what lands in the zip. Pointing it back at `dist` by accident
// would put a CDN address in the plugin and nothing else would notice.
/**
 * The XML namespaces, which look like addresses and are not.
 *
 * `createElementNS` needs the SVG one to draw an icon. Nothing is fetched from
 * any of them, and counting them as remote dependencies fails the build over a
 * paperclip.
 */
const NAMESPACES = ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/1999/xlink']

for (const file of GENERATED) {
  const found = readFileSync(join(assets, file), 'utf8').match(/\bhttps?:\/\/[^\s'"`]+/g) ?? []
  const remote = [...new Set(found)].filter((address) => !NAMESPACES.includes(address))
  if (remote.length === 0) continue

  console.error(`assets/${file} names a remote address, which the plugin directory does not allow:`)
  for (const address of remote) console.error(`  ${address}`)
  process.exit(1)
}
