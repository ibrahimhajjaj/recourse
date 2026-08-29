/**
 * Fails the build if anything Node-only reaches the serving path.
 *
 * The claim this example makes is that the chat handler runs on a Worker with
 * no `nodejs_compat` and no polyfills. That is true today because nothing on
 * the serving path imports a Node built-in, and it would stop being true the
 * first time somebody adds a `node:crypto` import to something the handler
 * happens to reach.
 *
 * A test cannot catch that; only a bundle can.
 */
import { build } from 'esbuild'

const LIMIT_KB = 200

const result = await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  // `neutral` has no Node built-ins to fall back on, so an import of one is an
  // error rather than something quietly polyfilled.
  platform: 'neutral',
  conditions: ['worker', 'browser'],
  external: ['ai', '@ai-sdk/*'],
  write: false,
  metafile: true,
  loader: { '.json': 'json' },
})

const output = result.outputFiles[0]
const kilobytes = output.contents.byteLength / 1024

const nodeImports = Object.keys(result.metafile.inputs).filter((file) => file.startsWith('node:'))

if (nodeImports.length > 0) {
  console.error(`\nNode built-ins reached the Worker bundle:\n  ${nodeImports.join('\n  ')}\n`)
  console.error('Something Node-only is on the serving path. Find it, and keep it off.')
  process.exit(1)
}

if (kilobytes > LIMIT_KB) {
  console.error(`\nBundle is ${kilobytes.toFixed(1)} KB, over the ${LIMIT_KB} KB budget.`)
  process.exit(1)
}

console.log(`\nWorker bundle: ${kilobytes.toFixed(1)} KB, no Node built-ins, no nodejs_compat needed.\n`)
