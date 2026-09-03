/**
 * Reads and writes the version, in every place this repository keeps one.
 *
 * There are eight, across three file formats, and a release where seven of them
 * agree is worse than one where none do: the plugin header is what WordPress
 * shows an administrator deciding whether to update, and it has already drifted
 * once. Nothing here commits, tags or publishes. Those are decisions, and they
 * stay in RELEASE.md where a person makes them.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every file holding a version, and the pattern that finds it.
 *
 * Each pattern captures the version in group 2, with the text either side in 1
 * and 3, so one routine can read and rewrite all of them.
 */
const PLACES = [
  { file: 'packages/core/package.json', find: /("version":\s*")([^"]+)(")/ },
  { file: 'packages/widget/package.json', find: /("version":\s*")([^"]+)(")/ },
  { file: 'packages/store-d1/package.json', find: /("version":\s*")([^"]+)(")/ },
  { file: 'packages/store-postgres/package.json', find: /("version":\s*")([^"]+)(")/ },
  { file: 'packages/wordpress/package.json', find: /("version":\s*")([^"]+)(")/ },
  // What WordPress shows in the plugins list, and what the plugin reports about
  // itself at runtime. Both are read by people, so both have to be right.
  { file: 'packages/wordpress/recourse.php', find: /(\* Version:\s+)([^\s]+)(\s*)/ },
  { file: 'packages/wordpress/recourse.php', find: /(define\( 'RECOURSE_VERSION', ')([^']+)(' \);)/ },
  // What the plugin directory serves as the current release.
  { file: 'packages/wordpress/readme.txt', find: /(Stable tag:\s+)([^\s]+)(\s*)/ },
]

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** The generated files CI refuses to accept out of date, and what rebuilds them. */
const GENERATED = [
  {
    what: 'the widget bundle',
    path: 'public/recourse.js',
    run: ['pnpm', ['-r', '--filter', './packages/*', 'build']],
  },
  {
    what: 'the parity fixtures',
    path: 'packages/wordpress/tests/fixtures/parity.json',
    run: ['pnpm', ['--filter', '@recourse-ai/wordpress', 'fixtures']],
  },
]

const read = (file) => readFileSync(join(root, file), 'utf8')

function versionIn(place) {
  const found = read(place.file).match(place.find)
  if (!found) throw new Error(`no version matched in ${place.file}`)
  return found[2]
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

/** Runs a generator, then reports whether it changed a tracked file. */
function staleness({ what, path, run }) {
  try {
    execFileSync(run[0], run[1], { cwd: root, stdio: 'ignore' })
  } catch {
    // Distinguished from staleness on purpose. A build that will not run is a
    // different problem from one whose output was not committed, and reporting
    // the first as the second sends you to rerun a command that already failed.
    return `could not regenerate ${what}, so whether it is current is unknown`
  }

  const changed = git('status', '--porcelain', '--', path).trim().length > 0
  return changed ? `${what} is out of date, commit the rebuilt ${path}` : null
}

function check() {
  const found = PLACES.map((place) => ({ file: place.file, version: versionIn(place) }))
  for (const { file, version } of found) console.log(`  ${version.padEnd(12)} ${file}`)

  const problems = []

  const distinct = [...new Set(found.map((one) => one.version))]
  if (distinct.length > 1) problems.push(`the version is not the same everywhere: ${distinct.join(', ')}`)

  const dirty = git('status', '--porcelain').trim()
  if (dirty) problems.push(`the working tree has uncommitted changes:\n${dirty}`)

  if (!/^## .+\(unreleased\)/m.test(read('CHANGELOG.md'))) {
    problems.push('CHANGELOG.md has no "(unreleased)" heading, so there is nothing to date')
  }

  console.log('\nregenerating, to see whether anything was left uncommitted')
  for (const one of GENERATED) {
    const problem = staleness(one)
    console.log(`  ${problem ? 'no ' : 'ok '} ${one.what}`)
    if (problem) problems.push(problem)
  }

  if (problems.length === 0) {
    console.log(`\nready. every version reads ${distinct[0]}.`)
    return
  }

  console.error(`\n${problems.length} thing${problems.length === 1 ? '' : 's'} to fix first:\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exitCode = 1
}

function set(next) {
  if (!next || !SEMVER.test(next)) {
    console.error(`"${next ?? ''}" is not a version. Expected something like 0.2.0.`)
    process.exitCode = 1
    return
  }

  // Every edit is worked out before any of it is written. A half-applied
  // version is the exact state this script exists to prevent, and a file that
  // stopped matching its pattern would otherwise leave the repository in one.
  const edits = new Map()
  for (const place of PLACES) {
    const before = edits.get(place.file) ?? read(place.file)
    if (!place.find.test(before)) {
      console.error(`nothing written: ${place.file} no longer matches ${place.find}`)
      process.exitCode = 1
      return
    }
    edits.set(place.file, before.replace(place.find, `$1${next}$3`))
  }

  const changelog = read('CHANGELOG.md')
  const dated = changelog.replace(/^## .+\(unreleased\)/m, `## ${next} (${today()})`)
  if (dated === changelog) {
    console.error('nothing written: CHANGELOG.md has no "(unreleased)" heading to date')
    process.exitCode = 1
    return
  }
  edits.set('CHANGELOG.md', dated)

  for (const [file, content] of edits) {
    writeFileSync(join(root, file), content)
    console.log(`  ${file}`)
  }
  console.log(`\n${next}. Nothing is committed, tagged or published.`)
}

/** The date where the person cutting the release is, which is the one they will look for. */
function today() {
  const now = new Date()
  const pad = (part) => String(part).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const [command, argument] = process.argv.slice(2)

if (command === 'check') check()
else if (command === 'set') set(argument)
else {
  console.error('usage: node scripts/release.mjs check')
  console.error('       node scripts/release.mjs set <version>')
  process.exitCode = 1
}
