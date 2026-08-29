/**
 * Copies the widget build into the plugin.
 *
 * Both files, minified and not. The directory's guidelines require the source
 * of anything compiled to be available: either in the zip or linked from the
 * readme. Shipping the readable file next to the minified one costs 30KB and
 * answers the question before it is asked.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const built = join(root, '..', 'widget', 'dist')
const assets = join(root, 'assets')

if (!existsSync(join(built, 'helpdeck.min.js'))) {
  console.error('No widget build found. Run `pnpm --filter @helpdeck/widget build` first.')
  process.exit(1)
}

mkdirSync(assets, { recursive: true })

for (const file of ['helpdeck.js', 'helpdeck.min.js']) {
  copyFileSync(join(built, file), join(assets, file))
  console.log(`  ${file}  ${(statSync(join(assets, file)).size / 1024).toFixed(1)} KB`)
}
