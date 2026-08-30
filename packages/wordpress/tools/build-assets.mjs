/**
 * Copies the widget build into the plugin.
 *
 * Both files, minified and not. The directory's guidelines require the source
 * of anything compiled to be available: either in the zip or linked from the
 * readme. Shipping the readable file next to the minified one costs 30KB and
 * answers the question before it is asked.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const built = join(root, '..', 'widget', 'dist')
const assets = join(root, 'assets')

if (!existsSync(join(built, 'helpdeck.min.js'))) {
  console.error('No widget build found. Run `pnpm --filter @helpdeck/widget build` first.')
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
if (existsSync(source) && newestSource(source) > statSync(join(built, 'helpdeck.min.js')).mtimeMs) {
  console.error('The widget build is older than the widget source.')
  console.error('Run `pnpm --filter @helpdeck/widget build` first, or the plugin ships the previous version.')
  process.exit(1)
}

mkdirSync(assets, { recursive: true })

for (const file of ['helpdeck.js', 'helpdeck.min.js']) {
  copyFileSync(join(built, file), join(assets, file))
  console.log(`  ${file}  ${(statSync(join(assets, file)).size / 1024).toFixed(1)} KB`)
}
