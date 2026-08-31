import { browserVoiceRoute } from '@recourse-ai/core/channels'

/**
 * The swap that lets the browser open a call without holding a key.
 *
 * The widget cannot connect to the voice service on its own: that connection
 * needs an account credential, and a credential in a page is a credential
 * anybody can read and spend. So the page asks here, this spends the key
 * server-side, and hands back a URL that is good for one call and expires.
 *
 * Guard it as you would any endpoint that costs money when it succeeds. The
 * limit below is per instance, which stops a script and does not stop a
 * determined one; put a shared limiter in front if the bill matters.
 */

const handler = browserVoiceRoute({
  agentId: process.env.ELEVENLABS_AGENT_ID ?? '',
  apiKey: process.env.ELEVENLABS_API_KEY ?? '',
  rateLimit: { limit: 5, windowMs: 10 * 60_000 },
})

export const POST = handler
export const OPTIONS = handler
