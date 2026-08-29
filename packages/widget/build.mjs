import { build, context } from 'esbuild'

/** The script-tag build: one self-contained IIFE that boots itself from data attributes. */
const embed = {
  entryPoints: ['src/embed.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  legalComments: 'none',
}

/** The npm build: named exports for people wiring it up themselves. */
const module = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  platform: 'browser',
  outfile: 'dist/index.js',
}

const builds = [
  { ...embed, outfile: 'dist/helpdeck.js' },
  { ...embed, outfile: 'dist/helpdeck.min.js', minify: true },
  module,
]

if (process.argv.includes('--watch')) {
  for (const options of builds) (await context(options)).watch()
  console.log('watching')
} else {
  await Promise.all(builds.map((options) => build(options)))
  const { copyFileSync, existsSync, statSync } = await import('node:fs')

  // The demo and the landing page serve the bundle from their own public
  // folders. Copying here rather than by hand is the only way they stay in
  // step: a stale copy shows visitors a widget that is months old.
  for (const destination of ['../../public/helpdeck.js', '../../examples/nextjs/public/helpdeck.js']) {
    const folder = destination.slice(0, destination.lastIndexOf('/'))
    if (existsSync(folder)) copyFileSync('dist/helpdeck.js', destination)
  }

  console.log(`helpdeck.min.js  ${(statSync('dist/helpdeck.min.js').size / 1024).toFixed(1)} KB`)
}
