export interface CorsOptions {
  /** Exact origins allowed to call the endpoint. `'*'` allows any. */
  allowedOrigins?: string[] | '*'
}

/**
 * The widget usually runs on the marketing site while the endpoint runs
 * somewhere else, so cross-origin is the normal case, not the exception.
 * Origins are matched exactly rather than by pattern: a wildcard on a support
 * endpoint is how someone else's site ends up spending your model budget.
 */
export function corsHeaders(request: Request, options: CorsOptions = {}): Record<string, string> {
  const allowed = options.allowedOrigins ?? '*'
  const origin = request.headers.get('origin')

  const value =
    allowed === '*' ? '*' : origin && allowed.includes(origin) ? origin : null

  if (!value) return {}

  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    ...(value === '*' ? {} : { Vary: 'Origin' }),
  }
}
