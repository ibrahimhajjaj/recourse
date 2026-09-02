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

/**
 * The budget is on code, not on this example's own data.
 *
 * `knowledge.json` is the index built from this repository's documentation, so
 * it grows whenever somebody writes a paragraph. Counting it made the guard
 * fail for writing docs, which is not what it is watching for, and it did:
 * the total crossed 200 KB on a day nobody touched the serving path.
 */
const LIMIT_KB = 175
const DATA = 'src/knowledge.json'

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
const bundled = Object.entries(result.metafile.outputs)[0]?.[1].inputs ?? {}
const dataBytes = bundled[DATA]?.bytesInOutput ?? 0
const kilobytes = (output.contents.byteLength - dataBytes) / 1024
const dataKilobytes = dataBytes / 1024

const nodeImports = Object.keys(result.metafile.inputs).filter((file) => file.startsWith('node:'))

if (nodeImports.length > 0) {
  console.error(`\nNode built-ins reached the Worker bundle:\n  ${nodeImports.join('\n  ')}\n`)
  console.error('Something Node-only is on the serving path. Find it, and keep it off.')
  process.exit(1)
}

if (kilobytes > LIMIT_KB) {
  console.error(`\nCode in the bundle is ${kilobytes.toFixed(1)} KB, over the ${LIMIT_KB} KB budget.`)
  console.error(`The index adds ${dataKilobytes.toFixed(1)} KB on top and is not counted here.`)
  process.exit(1)
}

console.log(`\nWorker bundle: ${kilobytes.toFixed(1)} KB of code plus ${dataKilobytes.toFixed(1)} KB of index, no Node built-ins, no nodejs_compat needed.\n`)
