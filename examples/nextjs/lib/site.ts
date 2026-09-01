/**
 * Where this app is reachable from its own server.
 *
 * An action that calls back into this app has to name a full URL, and writing
 * `http://localhost:3000` there is wrong twice over: it breaks the moment the
 * app runs on another port, and it is simply false once deployed, where the
 * server would be calling a machine that is not itself.
 *
 * Vercel sets `VERCEL_URL` without a scheme. `SITE_URL` overrides both, which
 * is what a tunnel or a second local port needs.
 */
export function siteUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`

  return `http://localhost:${process.env.PORT ?? 3000}`
}
