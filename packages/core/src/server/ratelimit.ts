export interface RateLimitOptions {
  /** Requests allowed per window, per caller. Zero disables the limiter. */
  limit?: number
  windowMs?: number
  /**
   * What a throttled visitor is told.
   *
   * The default says a machine refused them. A shop that knows its own traffic
   * can say something a customer can act on, and the one who trips this is
   * usually a real person asking too fast rather than the script it is for.
   */
  message?: string
}

export interface RateLimitResult {
  ok: boolean
  /** Seconds to wait, for the `Retry-After` header. */
  retryAfter: number
}

/**
 * Anything that can say whether a caller has had their share.
 *
 * Async because the useful implementations are not local. The in-memory one
 * returns a plain object and satisfies this fine, so the default path pays
 * nothing for the interface.
 */
export interface RateLimiter {
  check(key: string): RateLimitResult | Promise<RateLimitResult>
}

interface Bucket {
  count: number
  resetAt: number
}

/**
 * A fixed window counter held in memory. On serverless this is per-instance and
 * therefore approximate, which is the honest trade for having no Redis to run:
 * it stops a script hammering one instance, it is not a billing control. Put a
 * real limiter in front if the endpoint is public and the budget matters.
 */
export function createRateLimiter(options: RateLimitOptions = {}): (key: string) => RateLimitResult {
  const limit = options.limit ?? 30
  const windowMs = options.windowMs ?? 60_000
  const buckets = new Map<string, Bucket>()

  return function check(key: string): { ok: boolean; retryAfter: number } {
    if (limit <= 0) return { ok: true, retryAfter: 0 }

    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || now >= bucket.resetAt) {
      // Cheap eviction: without it a long-lived instance leaks a key per caller.
      if (buckets.size > 10_000) buckets.clear()
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return { ok: true, retryAfter: 0 }
    }

    bucket.count++
    if (bucket.count > limit) {
      return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
    }

    return { ok: true, retryAfter: 0 }
  }
}

/**
 * Best-effort caller identity behind the usual proxy headers.
 *
 * Read in order of how hard the value is to forge:
 *
 * - `cf-connecting-ip`, which Cloudflare writes itself and strips from
 *   whatever the client sent, and `x-real-ip`, which nginx and the other
 *   single-hop proxies overwrite. Either one is a value the last proxy set,
 *   so it is preferred whenever it is there.
 * - failing those, the **last** entry of `x-forwarded-for`. A proxy appends
 *   the address it saw to the end of that list, so the tail is the only hop
 *   the client did not get to write. Reading the head instead hands a script
 *   a fresh budget per request for the price of one made-up address.
 *
 * All three are still only headers, so directly exposed to the internet none
 * of them can be trusted: put a proxy in front, or key on an authenticated
 * identity instead. With no header at all every caller shares the `unknown`
 * bucket, which is coarse but is what an unproxied deployment already got.
 */
export function callerKey(request: Request): string {
  const platform = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip')
  if (platform?.trim()) return platform.trim()

  const forwarded = request.headers.get('x-forwarded-for')
  if (!forwarded) return 'unknown'

  const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean)
  return hops[hops.length - 1] ?? 'unknown'
}
