import { build, context } from 'esbuild'
import { rm } from 'node:fs/promises'

// esbuild writes to named outfiles and never removes anything, so a bundle
// that has been renamed survives in dist forever and gets published alongside
// its replacement. `files: ["dist"]` ships whatever is in there, so the stale
// copy reaches npm and anybody still loading the old name gets a build that
// stopped being updated. Clearing first is the only thing that prevents it.
await rm('dist', { recursive: true, force: true })

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
  { ...embed, outfile: 'dist/recourse.js' },
  { ...embed, outfile: 'dist/recourse.min.js', minify: true },
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
  for (const destination of ['../../public/recourse.js', '../../examples/nextjs/public/recourse.js']) {
    const folder = destination.slice(0, destination.lastIndexOf('/'))
    if (existsSync(folder)) copyFileSync('dist/recourse.js', destination)
  }

  console.log(`recourse.min.js  ${(statSync('dist/recourse.min.js').size / 1024).toFixed(1)} KB`)
}
