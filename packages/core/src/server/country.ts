/**
 * Where the visitor is, without ever handling where the visitor is.
 *
 * Every major edge network resolves the country before the request reaches an
 * origin and passes it as a header. Reading that is the whole implementation:
 * no address is received, none is stored, and there is no database to keep
 * current. An origin behind nothing gets no country, which is correct rather
 * than a limitation.
 *
 * A country on its own is not an identifier, but it is still information about
 * a person, so it is off unless asked for and gated on consent by the host.
 */

/** The header each network uses, in the order they are checked. */
const HEADERS = [
  'cf-ipcountry', // Cloudflare
  'x-vercel-ip-country', // Vercel
  'x-nf-client-connection-ip-country', // Netlify
  'x-appengine-country', // Google App Engine
  'x-geo-country', // Fastly, when configured
  'cloudfront-viewer-country', // AWS CloudFront
]

/**
 * The two-letter country for a request, or undefined.
 *
 * `XX` and `T1` are what Cloudflare sends for an unknown client and for Tor,
 * and neither is a place.
 */
export function countryFrom(request: Request): string | undefined {
  for (const header of HEADERS) {
    const value = request.headers.get(header)?.trim().toUpperCase()
    if (!value || value.length !== 2 || value === 'XX' || value === 'T1') continue
    return value
  }

  return undefined
}

/**
 * Consent as a header, for hosts that have a consent banner already.
 *
 * The value is a comma separated list of what the visitor agreed to, which is
 * the shape a consent manager already holds. Nothing is assumed from its
 * absence: no header is no consent.
 *
 *     analytics: { country: consented('analytics') }
 */
export function consented(purpose: string): (request: Request) => boolean {
  return (request) =>
    (request.headers.get('x-recourse-consent') ?? '')
      .split(',')
      .map((one) => one.trim().toLowerCase())
      .includes(purpose.toLowerCase())
}
