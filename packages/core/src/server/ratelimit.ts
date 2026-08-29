export interface RateLimitOptions {
  /** Requests allowed per window, per caller. Zero disables the limiter. */
  limit?: number
  windowMs?: number
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
 * `x-forwarded-for` is a header the client can set, so this is only
 * trustworthy behind a proxy that overwrites it rather than appending. Vercel,
 * Cloudflare and most load balancers do. Directly exposed, a caller can spoof
 * it and get a fresh budget per request, so put something in front or key on
 * an authenticated identity instead.
 */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return (forwarded.split(',')[0] ?? '').trim() || 'unknown'
  return request.headers.get('x-real-ip') ?? 'unknown'
}
