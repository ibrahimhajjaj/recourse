import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Serves the widget from this app's own origin. In production you would point
 * the script tag at a CDN instead; copying it here keeps the example working
 * with no network and makes the served file obviously the one you just built.
 */
const require = createRequire(import.meta.url)
const dist = dirname(require.resolve('@recourse/widget/package.json'))

await mkdir('public', { recursive: true })
await copyFile(join(dist, 'dist/recourse.min.js'), 'public/recourse.js')
console.log('copied widget to public/recourse.js')
