/**
 * A tiny path router.
 *
 * Written here rather than pulled in because the API has around twenty routes
 * and no framework: adding one would decide the host's framework for them,
 * which is exactly what a library embedded in someone else's app must not do.
 */
export type Params = Record<string, string>
export type RouteHandler = (request: Request, params: Params) => Promise<Response> | Response

interface Route {
  method: string
  segments: string[]
  handler: RouteHandler
}

export function createRouter() {
  const routes: Route[] = []

  function add(method: string, pattern: string, handler: RouteHandler) {
    routes.push({ method, segments: pattern.split('/').filter(Boolean), handler })
  }

  return {
    get: (pattern: string, handler: RouteHandler) => add('GET', pattern, handler),
    post: (pattern: string, handler: RouteHandler) => add('POST', pattern, handler),
    patch: (pattern: string, handler: RouteHandler) => add('PATCH', pattern, handler),
    put: (pattern: string, handler: RouteHandler) => add('PUT', pattern, handler),
    delete: (pattern: string, handler: RouteHandler) => add('DELETE', pattern, handler),

    /** Returns null when nothing matched, so the caller decides what a 404 is. */
    match(method: string, pathname: string): { handler: RouteHandler; params: Params } | null {
      const parts = pathname.split('/').filter(Boolean)

      for (const route of routes) {
        if (route.method !== method) continue
        if (route.segments.length !== parts.length) continue

        const params: Params = {}
        let matched = true

        for (const [index, segment] of route.segments.entries()) {
          const value = parts[index] as string
          if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value)
          else if (segment !== value) {
            matched = false
            break
          }
        }

        if (matched) return { handler: route.handler, params }
      }

      return null
    },
  }
}
