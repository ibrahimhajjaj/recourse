export interface RetryOptions {
  attempts?: number
  signal?: AbortSignal
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

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
      if (!RETRYABLE.has(response.status)) return response
      lastError = new Error(`${response.status} ${response.statusText}`)
    } catch (error) {
      // An aborted request is a decision, not a failure to retry through.
      if (error instanceof Error && error.name === 'AbortError') throw error
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
