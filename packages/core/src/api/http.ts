/** Shared response helpers, so every endpoint answers in the same shape. */

export function ok(data: unknown, extra: Record<string, unknown> = {}): Response {
  return json({ data, ...extra }, 200)
}

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Errors carry a stable machine-readable code alongside the message, because a
 * client that has to string-match on prose breaks the first time the prose is
 * improved.
 */
export function fail(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status)
}

export function notFound(what: string): Response {
  return fail('not_found', `no such ${what}`, 404)
}

export function badRequest(message: string): Response {
  return fail('bad_request', message, 400)
}

/** Reads and validates a JSON body, returning the error response on failure. */
export async function readJson<T>(request: Request): Promise<{ body: T } | { error: Response }> {
  try {
    return { body: (await request.json()) as T }
  } catch {
    return { error: badRequest('expected a JSON body') }
  }
}

export function pageParams(url: URL): { limit?: number; cursor?: string } {
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  return {
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  }
}
