export interface RateLimitOptions {
  /** Requests allowed per window, per caller. Zero disables the limiter. */
  limit?: number
  windowMs?: number
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
export function createRateLimiter(options: RateLimitOptions = {}) {
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

/** Best-effort caller identity behind the usual proxy headers. */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return (forwarded.split(',')[0] ?? '').trim() || 'unknown'
  return request.headers.get('x-real-ip') ?? 'unknown'
}
