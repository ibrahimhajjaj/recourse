/**
 * A ceiling on what one deployment may spend answering questions.
 *
 * The rate limiter caps how often a single caller may ask. It does not cap the
 * bill: a thousand callers each staying politely under their own limit still
 * add up, and a widget on a public page is reachable by anything that can make
 * an HTTP request. This is the other half, and it is the control a self-hoster
 * asks about before putting their own provider key behind a public endpoint.
 *
 * Caps come in two currencies. Tokens are exact and never go stale, so they
 * are the honest default. Dollars are what an owner actually budgets in, and
 * they need a price per model, which is a number this file can only ever hold
 * a snapshot of. Set both and whichever is reached first stops the turn.
 */

/** What one model call consumed. Either half may be missing; providers vary. */
export interface Usage {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
}

/** USD per million tokens, the unit every provider publishes. */
export interface ModelPrice {
  input: number
  output: number
}

export type PriceList = Record<string, ModelPrice>

/**
 * When {@link PRICES} was last checked against the providers' own pages.
 *
 * Read this before trusting a dollar figure. Model prices move, they move
 * downward faster than a library gets republished, and a table baked into a
 * package is a snapshot of the day somebody typed it. A cost that matters is
 * one you pass your own `prices` for.
 */
export const PRICES_CHECKED = '2026-08-31'

/**
 * Enough models to make a dollar cap work out of the box, not a directory.
 *
 * These are the ids this library defaults to or documents. Anything else
 * prices as unknown, which is reported rather than counted as free: a budget
 * that silently values half its traffic at zero is worse than no budget.
 */
export const PRICES: PriceList = {
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-4o': { input: 2.5, output: 10 },
  'openai/gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'anthropic/claude-haiku-4.5': { input: 1, output: 5 },
  'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
  'google/gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'google/gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
}

/**
 * What a call cost, or `undefined` when the model is not in the list.
 *
 * The provider prefix is optional on the way in, so `gpt-4o-mini` and
 * `openai/gpt-4o-mini` both price. A locally hosted model has no price at all
 * and should not: the electricity is not billed per token.
 */
export function costOf(model: string, usage: Usage, prices: PriceList = PRICES): number | undefined {
  const price = prices[model] ?? prices[Object.keys(prices).find((id) => id.endsWith(`/${model}`)) ?? '']
  if (!price) return undefined

  const input = ((usage.inputTokens ?? 0) / 1_000_000) * price.input
  const output = ((usage.outputTokens ?? 0) / 1_000_000) * price.output
  return input + output
}

/**
 * Where the running totals live.
 *
 * One counter per window, added to and read back. Deliberately this small so
 * that anything with an atomic increment can be one: a Map, Redis, a row in
 * whatever database is already there.
 */
export interface Ledger {
  /** Adds to a window's total and returns what it now holds. */
  add(key: string, amount: number): Promise<number>
  total(key: string): Promise<number>
}

/**
 * Totals held in this process.
 *
 * Correct for a single long-lived server and wrong everywhere else, in the two
 * ways worth knowing: N instances give the deployment N budgets, and a restart
 * forgets the day. It is still the right default, because the failure it
 * prevents is a runaway loop billing for hours, and a per-instance counter
 * catches that. Reach for {@link redisLedger} when the budget is the point.
 */
export function memoryLedger(): Ledger {
  const totals = new Map<string, number>()

  return {
    async add(key, amount) {
      const next = (totals.get(key) ?? 0) + amount
      totals.set(key, next)
      return next
    },
    async total(key) {
      return totals.get(key) ?? 0
    },
  }
}

/**
 * Any Redis client with a float increment and an expiry.
 *
 * Structural rather than an import, the same way the shared rate limiters take
 * a client rather than depending on one.
 */
export interface FloatCounter {
  incrbyfloat(key: string, amount: number): Promise<string | number>
  get(key: string): Promise<string | null>
  pexpire(key: string, milliseconds: number): Promise<unknown>
}

export interface RedisLedgerOptions {
  client: FloatCounter
  /** Distinguishes deployments sharing one database. */
  prefix?: string
}

/**
 * Totals every instance shares.
 *
 * Keys carry their own window in the name, so yesterday's counter is never
 * read again; the expiry exists only to stop them accumulating forever. A day
 * key outlives its day by a margin because "today" depends on the clock of
 * whichever instance wrote it.
 */
export function redisLedger(options: RedisLedgerOptions): Ledger {
  const prefix = options.prefix ?? 'helpdeck:spend'
  const ttl = (key: string) => (key.includes(':m:') ? 45 * 86_400_000 : 2 * 86_400_000)

  return {
    async add(key, amount) {
      const full = `${prefix}:${key}`
      const next = Number(await options.client.incrbyfloat(full, amount))
      await options.client.pexpire(full, ttl(key))
      return Number.isFinite(next) ? next : 0
    },
    async total(key) {
      const held = await options.client.get(`${prefix}:${key}`)
      const value = Number(held ?? 0)
      return Number.isFinite(value) ? value : 0
    },
  }
}

export interface BudgetOptions {
  /** Tokens, counting input and output together. Exact, and never goes stale. */
  dailyTokens?: number
  monthlyTokens?: number
  /** US dollars, which needs `prices` to cover every model actually used. */
  dailyUsd?: number
  monthlyUsd?: number
  /** Overrides or extends {@link PRICES}. Merged over it, not replacing it. */
  prices?: PriceList
  ledger?: Ledger
  /**
   * `pause` stops the turn before the model is called and says so. `warn` logs
   * and lets it through, which is what you want for the first month while you
   * find out what normal traffic costs.
   */
  onExceeded?: 'pause' | 'warn'
  /** What the customer hears when a cap has paused the agent. */
  message?: string
  /** Injected so tests do not depend on the calendar. */
  now?: () => Date
}

export interface BudgetVerdict {
  ok: boolean
  /** Which cap stopped it, for the log rather than the customer. */
  reason?: string
  /** What to say to the customer. Only set when `ok` is false. */
  message?: string
}

export interface Spend {
  tokens: number
  usd: number
}

export interface Budget {
  /** Called before the model. A false verdict means do not call it at all. */
  check(): Promise<BudgetVerdict>
  /** Called after, with what the turn actually used. */
  record(model: string, usage: Usage): Promise<void>
  /** Today's and this month's totals, for a dashboard. */
  spent(): Promise<{ day: Spend; month: Spend }>
}

const DEFAULT_MESSAGE =
  'Our assistant has reached the limit set for today, so I cannot answer right now. ' +
  'Leave your question and a person will pick it up.'

/**
 * Turns caps into a check to run before the model and a total to add after.
 *
 * Checking before rather than after is the whole point: the turn that crosses
 * the line is the one you did not want to pay for, and a check that runs
 * afterwards has already paid for it.
 */
export function createBudget(options: BudgetOptions = {}): Budget {
  const ledger = options.ledger ?? memoryLedger()
  const prices = { ...PRICES, ...(options.prices ?? {}) }
  const clock = options.now ?? (() => new Date())
  const pauses = (options.onExceeded ?? 'pause') === 'pause'
  const unpriced = new Set<string>()

  /** `2026-08-31` and `2026-08`, from the same instant so they cannot disagree. */
  function windows(): { day: string; month: string } {
    const stamp = clock().toISOString()
    return { day: `d:${stamp.slice(0, 10)}`, month: `m:${stamp.slice(0, 7)}` }
  }

  async function read(window: string): Promise<Spend> {
    const [tokens, usd] = await Promise.all([ledger.total(`tokens:${window}`), ledger.total(`usd:${window}`)])
    return { tokens, usd }
  }

  return {
    async check() {
      const capped =
        options.dailyTokens ?? options.monthlyTokens ?? options.dailyUsd ?? options.monthlyUsd
      if (capped === undefined) return { ok: true }

      const { day, month } = windows()
      const [today, thisMonth] = await Promise.all([read(day), read(month)])

      const over: Array<[number | undefined, number, string]> = [
        [options.dailyTokens, today.tokens, 'daily token cap'],
        [options.monthlyTokens, thisMonth.tokens, 'monthly token cap'],
        [options.dailyUsd, today.usd, 'daily spend cap'],
        [options.monthlyUsd, thisMonth.usd, 'monthly spend cap'],
      ]

      for (const [cap, used, name] of over) {
        if (cap === undefined || used < cap) continue

        const reason = `${name} reached: ${round(used)} of ${cap}`
        if (!pauses) {
          console.warn(`[helpdeck] ${reason}. Still answering, because onExceeded is "warn".`)
          continue
        }
        return { ok: false, reason, message: options.message ?? DEFAULT_MESSAGE }
      }

      return { ok: true }
    },

    async record(model, usage) {
      const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      const usd = costOf(model, usage, prices)

      if (usd === undefined && !unpriced.has(model)) {
        unpriced.add(model)
        console.warn(
          `[helpdeck] no price for model "${model}", so it counts towards token caps but not spend caps. ` +
            'Pass prices: { "' + model + '": { input, output } } if you cap in dollars.',
        )
      }

      const { day, month } = windows()
      const writes: Array<Promise<unknown>> = []

      if (tokens > 0) {
        writes.push(ledger.add(`tokens:${day}`, tokens), ledger.add(`tokens:${month}`, tokens))
      }
      if (usd !== undefined && usd > 0) {
        writes.push(ledger.add(`usd:${day}`, usd), ledger.add(`usd:${month}`, usd))
      }

      await Promise.all(writes)
    },

    async spent() {
      const { day, month } = windows()
      const [today, thisMonth] = await Promise.all([read(day), read(month)])
      return { day: today, month: thisMonth }
    },
  }
}

/** Enough digits to read, few enough not to imply a precision cents lack. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
