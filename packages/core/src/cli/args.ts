export interface Parsed {
  command: string | undefined
  positionals: string[]
  flags: Record<string, string | boolean>
}

/**
 * Hand-rolled so the CLI ships with no dependencies. Supports `--flag`,
 * `--flag=value`, `--flag value` and `--no-flag`.
 */
export function parseArgs(argv: string[]): Parsed {
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string

    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const body = token.slice(2)
    const equals = body.indexOf('=')

    if (equals !== -1) {
      flags[body.slice(0, equals)] = body.slice(equals + 1)
      continue
    }

    if (body.startsWith('no-')) {
      flags[body.slice(3)] = false
      continue
    }

    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next
      i++
    } else {
      flags[body] = true
    }
  }

  return { command: positionals[0], positionals: positionals.slice(1), flags }
}

export function num(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function list(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== 'string') return undefined
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
