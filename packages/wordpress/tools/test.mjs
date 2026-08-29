/**
 * Runs the PHP suite, and says so rather than passing when it cannot.
 *
 * The repo's `pnpm verify` covers every package, and most people running it
 * have no PHP and no reason to. So a missing toolchain skips loudly, the same
 * shape as the Postgres store's tests, which skip without a database rather
 * than failing on every machine that has not got one.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

function have(command, commandArgs = ['--version']) {
  return spawnSync(command, commandArgs, { stdio: 'ignore' }).status === 0
}

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' }).status ?? 1
}

function skip(why) {
  console.log(`skipped: ${why}`)
  process.exit(0)
}

// PHP 7.4 is the floor this plugin claims, and `php -l` only proves a file
// parses. Running the suite on 7.4 is what proves it works there.
if (args.includes('--php74')) {
  if (!have('docker', ['info'])) skip('docker is not running, so PHP 7.4 cannot be checked')
  process.exit(
    run('docker', [
      'run', '--rm', '-v', `${root}:/app`, '-w', '/app', 'php:7.4-cli',
      'php', 'vendor/bin/phpunit',
    ]),
  )
}

if (!have('php')) skip('no php on this machine')

if (args.includes('--lint-only')) {
  const files = spawnSync('find', ['includes', 'tests', '-name', '*.php'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim().split('\n').filter(Boolean)

  for (const file of files) {
    if (run('php', ['-l', file]) !== 0) process.exit(1)
  }
  process.exit(0)
}

if (!existsSync(join(root, 'vendor', 'bin', 'phpunit'))) {
  skip('no vendor directory; run `composer install` in packages/wordpress')
}

process.exit(runSuite(['vendor/bin/phpunit']))

/**
 * Runs PHPUnit and refuses to pass on a run that tested nothing.
 *
 * A class opening with `defined( 'ABSPATH' ) || exit;` loaded from the bootstrap
 * does exactly that: the process ends during bootstrap, PHPUnit prints nothing,
 * and the exit code is zero. Green, silent, and testing not one thing. The
 * count is checked rather than trusted.
 */
function runSuite(command) {
  const result = spawnSync('php', command, { cwd: root, encoding: 'utf8' })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')

  if (result.status !== 0) return result.status ?? 1

  if (!/\b(OK|Tests:)\b/.test(result.stdout ?? '')) {
    console.error(
      '\nPHPUnit exited cleanly without running anything. Something in the ' +
        'bootstrap ended the process, which is almost always a file guarded ' +
        'with `defined( \'ABSPATH\' ) || exit;`.',
    )
    return 1
  }

  return 0
}
