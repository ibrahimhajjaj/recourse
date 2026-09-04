import { build, context } from 'esbuild'
import { rm } from 'node:fs/promises'

// esbuild writes to named outfiles and never removes anything, so a bundle
// that has been renamed survives in dist forever and gets published alongside
// its replacement. `files: ["dist"]` ships whatever is in there, so the stale
// copy reaches npm and anybody still loading the old name gets a build that
// stopped being updated. Clearing first is the only thing that prevents it.
await rm('dist', { recursive: true, force: true })

/**
 * Compile-time answers to "may this build reach the network for code?".
 *
 * Only one thing asks: the loader that pulls the voice runtime from a CDN the
 * first time somebody places a call. Everywhere but WordPress the answer is
 * yes, and the branch below is what makes it no in the plugin build.
 */
const fetching = (allowed) => ({ __RECOURSE_FETCH_RUNTIME__: String(allowed) })

/** The script-tag build: one self-contained IIFE that boots itself from data attributes. */
const embed = {
  entryPoints: ['src/embed.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  legalComments: 'none',
  define: fetching(true),
}

/** The npm build: named exports for people wiring it up themselves. */
const module = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  platform: 'browser',
  outfile: 'dist/index.js',
  define: fetching(true),
}

/**
 * The build that goes in the WordPress plugin zip.
 *
 * Same source, compiled without the CDN loader. The plugin never turns the
 * call button on, so nothing is lost, and the directory's guidelines are
 * unambiguous that a plugin may not pull code from a remote host: a URL left
 * in the file is a finding whether or not any code path reaches it.
 *
 * Its own directory, under the names the plugin enqueues, so copying it in is
 * a copy rather than a rename that could quietly pick up the wrong file.
 */
const plugin = {
  ...embed,
  define: fetching(false),
  // Constant folding, which is what actually removes the address rather than
  // leaving `false ? "https://..." : ""` sitting in the file. esbuild only
  // folds under minification, and the readable build ships to the directory as
  // the source of the minified one, so it takes the syntax pass alone: names,
  // line breaks and structure survive, dead branches do not.
  minifySyntax: true,
}

const wordpress = [
  { ...plugin, outfile: 'dist/wordpress/recourse.js' },
  { ...plugin, outfile: 'dist/wordpress/recourse.min.js', minify: true },
]

const builds = [
  { ...embed, outfile: 'dist/recourse.js' },
  { ...embed, outfile: 'dist/recourse.min.js', minify: true },
  module,
  ...wordpress,
]

/**
 * Addresses in a bundle that a browser would actually go and fetch.
 *
 * The XML namespaces are the exception worth naming: `createElementNS` needs
 * the SVG one and it looks exactly like a URL, but nothing is ever requested
 * from it. Treating it as a remote dependency fails the build over an icon.
 */
const NAMESPACES = ['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/1999/xlink']

function remoteAddresses(source) {
  const found = source.match(/\bhttps?:\/\/[^\s'"`]+/g) ?? []
  return [...new Set(found)].filter((address) => !NAMESPACES.includes(address))
}

if (process.argv.includes('--watch')) {
  for (const options of builds) (await context(options)).watch()
  console.log('watching')
} else {
  await Promise.all(builds.map((options) => build(options)))
  const { copyFileSync, existsSync, statSync } = await import('node:fs')

  // The demo and the landing page serve the bundle from their own public
  // folders. Copying here rather than by hand is the only way they stay in
  // step: a stale copy shows visitors a widget that is months old.
  //
  // The minified one, because these are served to browsers. Copying the
  // readable build put 88 KB in front of visitors where 53 KB was the intent,
  // and the size printed below described a file nobody was being sent.
  for (const destination of ['../../public/recourse.js', '../../examples/nextjs/public/recourse.js']) {
    const folder = destination.slice(0, destination.lastIndexOf('/'))
    if (existsSync(folder)) copyFileSync('dist/recourse.min.js', destination)
  }

  // The plugin build's whole purpose, asserted rather than assumed. A remote
  // address anywhere in the file is a rejection from the plugin directory, and
  // the way one gets back in is a new import somebody adds months from now
  // without knowing this constraint exists. Failing the build is how they find
  // out here rather than in a review email.
  const { readFileSync } = await import('node:fs')
  for (const file of ['dist/wordpress/recourse.js', 'dist/wordpress/recourse.min.js']) {
    const remote = remoteAddresses(readFileSync(file, 'utf8'))
    if (remote.length > 0) {
      console.error(`${file} names a remote address, which the plugin directory does not allow:`)
      for (const found of remote) console.error(`  ${found}`)
      process.exit(1)
    }
  }

  console.log(`recourse.min.js  ${(statSync('dist/recourse.min.js').size / 1024).toFixed(1)} KB`)
  console.log(`wordpress/recourse.min.js  ${(statSync('dist/wordpress/recourse.min.js').size / 1024).toFixed(1)} KB`)
}
