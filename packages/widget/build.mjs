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
  const { statSync } = await import('node:fs')
  console.log(`helpdeck.min.js  ${(statSync('dist/helpdeck.min.js').size / 1024).toFixed(1)} KB`)
}
