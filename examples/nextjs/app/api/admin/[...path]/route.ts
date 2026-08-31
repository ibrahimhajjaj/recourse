import { createApiHandler } from 'recourse/api'
import { helpdesk, store } from '../../../../lib/helpdesk'

/**
 * The management API, mounted under /api/admin.
 *
 * Left open here because the demo has nothing worth stealing. On a real
 * deployment set `tokens` from the environment, or put it behind whatever
 * already authenticates your staff.
 */
const handler = createApiHandler({
  store,
  helpdesk,
  basePath: '/api/admin',
  admin: true,
  tokens: process.env.RECOURSE_API_TOKEN ? [process.env.RECOURSE_API_TOKEN] : undefined,
})

export const GET = handler
export const POST = handler
export const PATCH = handler
export const PUT = handler
export const DELETE = handler
export const OPTIONS = handler
