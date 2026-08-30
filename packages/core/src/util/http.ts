export interface RetryOptions {
  attempts?: number
  signal?: AbortSignal
  /**
   * Retry only where the server certainly did not act on the request.
   *
   * For a GET, repeating a request that may already have been processed costs
   * nothing. For a POST that creates something it is a second one of whatever
   * it created, and a gateway timeout cannot tell you which side of the write
   * it happened on. Set this on any call that is not safe to repeat blindly.
   */
  onlyIfUntouched?: boolean
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

/**
 * The subset that means the request was rejected before anything happened:
 * too early, too many, or nothing available to serve it. A 500 or a 502 can
 * arrive after the work was done, and a dropped connection says nothing at
 * all about whether the other end finished.
 */
const UNTOUCHED = new Set([408, 425, 429, 503])

/**
 * Retries on the status codes that mean "ask again later" and gives up on the
 * ones that mean "this will never work". Backoff is exponential with jitter so
 * a crawl of 200 pages does not resynchronise into a thundering herd after the
 * first rate-limit response.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = options.attempts ?? 4
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const backoff = 500 * 2 ** (attempt - 1) + Math.random() * 250
      await sleep(backoff, options.signal)
    }

    try {
      const response = await fetch(url, { ...init, signal: options.signal ?? init.signal })
      const retryable = options.onlyIfUntouched
        ? UNTOUCHED.has(response.status)
        : RETRYABLE.has(response.status)
      if (!retryable) return response
      lastError = new Error(`${response.status} ${response.statusText}`)
    } catch (error) {
      // An aborted request is a decision, not a failure to retry through.
      if (error instanceof Error && error.name === 'AbortError') throw error
      // A thrown request may have been received and answered into a socket
      // that closed, so it is exactly the ambiguous case.
      if (options.onlyIfUntouched) throw error
      lastError = error
    }
  }

  throw new Error(`request failed after ${attempts} attempts: ${url} (${String(lastError)})`)
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}
