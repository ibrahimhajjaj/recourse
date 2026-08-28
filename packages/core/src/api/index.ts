import type { Store } from '../store/types.js'
import type { Helpdesk } from '../helpdesk/service.js'
import type { StatusCategory } from '../helpdesk/types.js'
import { corsHeaders, type CorsOptions } from '../server/cors.js'
import { createRouter } from './router.js'
import { badRequest, fail, json, notFound, ok, pageParams, readJson } from './http.js'

export interface ApiOptions {
  store: Store
  /** Enables the ticket routes. Omit it and they answer 501. */
  helpdesk?: Helpdesk
  /**
   * Bearer tokens allowed to call this. Omit it and the API is open, which is
   * only ever right behind your own network.
   */
  tokens?: string[]
  cors?: CorsOptions
  /** Strips a mount prefix, so the API can live under /api/v1 or anywhere. */
  basePath?: string
}

/**
 * The management API: everything the widget does not do.
 *
 * Reading transcripts, finding the questions nobody could answer, working the
 * ticket queue. It is a `Request -> Response` function like the chat handler,
 * so it mounts wherever that does.
 *
 * There is deliberately no create-an-agent endpoint. In a hosted product an
 * account holds many agents; here the deployment is the agent, so its
 * configuration is code and belongs in your repository rather than behind a
 * POST that only some of your environments would have run.
 */
export function createApiHandler(options: ApiOptions) {
  const { store } = options
  const router = createRouter()
  const base = (options.basePath ?? '').replace(/\/+$/, '')

  router.get('/health', async () => ok({ status: 'ok', store: store.name }))

  // ---- conversations -------------------------------------------------------

  router.get('/conversations', async (request) => {
    const url = new URL(request.url)
    const page = await store.listConversations({
      ...pageParams(url),
      channel: url.searchParams.get('channel') ?? undefined,
      since: url.searchParams.get('since') ?? undefined,
      until: url.searchParams.get('until') ?? undefined,
      unansweredOnly: url.searchParams.get('unanswered') === 'true',
    })
    return ok(page.items, { pagination: { cursor: page.cursor } })
  })

  router.get('/conversations/:id', async (_request, params) => {
    const found = await store.getConversation(params.id as string)
    if (!found) return notFound('conversation')
    return ok({ ...found.conversation, messages: found.messages })
  })

  router.get('/conversations/:id/messages', async (_request, params) => {
    const found = await store.getConversation(params.id as string)
    if (!found) return notFound('conversation')
    return ok(found.messages)
  })

  router.patch('/conversations/:id/messages/:messageId/feedback', async (request, params) => {
    const parsed = await readJson<{ feedback?: unknown }>(request)
    if ('error' in parsed) return parsed.error

    const { feedback } = parsed.body
    if (feedback !== 'positive' && feedback !== 'negative' && feedback !== null) {
      return badRequest('feedback must be "positive", "negative" or null')
    }

    const found = await store.getConversation(params.id as string)
    if (!found) return notFound('conversation')
    if (!found.messages.some((message) => message.id === params.messageId)) return notFound('message')

    await store.setFeedback(params.id as string, params.messageId as string, feedback)
    return ok({ id: params.messageId, feedback })
  })

  // ---- what the agent could not answer -------------------------------------

  router.get('/leads', async (request) => {
    const page = await store.listLeads(pageParams(new URL(request.url)))
    return ok(page.items, { pagination: { cursor: page.cursor } })
  })

  router.get('/stats', async (request) => {
    const url = new URL(request.url)
    return ok(
      await store.stats({
        since: url.searchParams.get('since') ?? undefined,
        until: url.searchParams.get('until') ?? undefined,
      }),
    )
  })

  // ---- help desk -----------------------------------------------------------

  const desk = () => options.helpdesk

  router.get('/helpdesk/teams', async () => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()
    return ok(helpdesk.teams().map(({ id, name, isDefault, members }) => ({
      id,
      name,
      isDefault,
      memberCount: members.length,
    })))
  })

  router.get('/helpdesk/ticket-statuses', async () => {
    const helpdesk = desk()
    return helpdesk ? ok(helpdesk.statuses()) : noHelpdesk()
  })

  router.get('/helpdesk/views', async () => {
    const helpdesk = desk()
    return helpdesk ? ok(helpdesk.views()) : noHelpdesk()
  })

  router.get('/helpdesk/views/:id', async (_request, params) => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()

    try {
      const page = await helpdesk.runView(params.id as string)
      return ok(page.items, { pagination: { cursor: page.cursor } })
    } catch {
      return notFound('view')
    }
  })

  router.post('/helpdesk/tickets/:number/draft', async (_request, params) => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()

    const number = Number.parseInt(params.number as string, 10)
    if (!Number.isFinite(number)) return badRequest('ticket number must be a number')

    try {
      const draft = await helpdesk.draftReply(number)
      // A draft is never sent, so this is a read even though it is a POST.
      return draft ? ok(draft) : notFound('ticket')
    } catch (error) {
      return fail(
        'drafting_unavailable',
        error instanceof Error ? error.message : 'could not draft a reply',
        501,
      )
    }
  })

  router.get('/helpdesk/tickets', async (request) => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()

    const url = new URL(request.url)
    const category = url.searchParams.get('statusCategory')
    const assignee = url.searchParams.get('assigneeId')

    const page = await helpdesk.listTickets({
      ...pageParams(url),
      statusCategory: (category as StatusCategory) ?? undefined,
      teamId: url.searchParams.get('teamId') ?? undefined,
      // `?assigneeId=none` is how a queue asks for unclaimed work.
      assigneeId: assignee === 'none' ? null : (assignee ?? undefined),
      openOnly: url.searchParams.get('open') === 'true',
    })

    return ok(page.items, { pagination: { cursor: page.cursor } })
  })

  router.post('/helpdesk/tickets', async (request) => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()

    const parsed = await readJson<{
      subject?: string
      description?: string
      customer?: { id?: string; name?: string; email?: string; phoneNumber?: string }
      teamId?: string
      assigneeId?: string
      channel?: string
      conversationId?: string
    }>(request)
    if ('error' in parsed) return parsed.error

    const { subject, description, customer } = parsed.body
    if (!subject?.trim() || !description?.trim()) {
      return badRequest('a ticket needs a subject and a description')
    }

    const ticket = await helpdesk.openTicket({
      subject,
      description,
      customer: customer ?? {},
      teamId: parsed.body.teamId,
      assigneeId: parsed.body.assigneeId,
      channel: parsed.body.channel ?? 'api',
      conversationId: parsed.body.conversationId,
    })

    return json({ data: ticket }, 201)
  })

  router.post('/helpdesk/tickets/search', async (request) => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()

    const parsed = await readJson<{ query?: string; limit?: number }>(request)
    if ('error' in parsed) return parsed.error
    if (!parsed.body.query?.trim()) return badRequest('search needs a query')

    return ok(await helpdesk.searchTickets(parsed.body.query, parsed.body.limit))
  })

  router.get('/helpdesk/tickets/:number', async (_request, params) => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()

    const number = Number.parseInt(params.number as string, 10)
    if (!Number.isFinite(number)) return badRequest('ticket number must be a number')

    const ticket = await helpdesk.getTicket(number)
    return ticket ? ok(ticket) : notFound('ticket')
  })

  router.patch('/helpdesk/tickets/:number', async (request, params) => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()

    const number = Number.parseInt(params.number as string, 10)
    if (!Number.isFinite(number)) return badRequest('ticket number must be a number')

    const parsed = await readJson<{
      statusId?: string
      statusCategory?: StatusCategory
      assigneeId?: string | null
      teamId?: string | null
    }>(request)
    if ('error' in parsed) return parsed.error

    try {
      const ticket = await helpdesk.update(number, parsed.body)
      return ticket ? ok(ticket) : notFound('ticket')
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'could not update the ticket')
    }
  })

  router.get('/helpdesk/tickets/:number/messages', async (_request, params) => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()

    const number = Number.parseInt(params.number as string, 10)
    if (!(await helpdesk.getTicket(number))) return notFound('ticket')

    const page = await helpdesk.listMessages(number)
    return ok(page.items, { pagination: { cursor: page.cursor } })
  })

  router.post('/helpdesk/tickets/:number/messages', async (request, params) => {
    const helpdesk = desk()
    if (!helpdesk) return noHelpdesk()

    const number = Number.parseInt(params.number as string, 10)
    const parsed = await readJson<{
      type?: 'reply' | 'note'
      content?: string
      authorName?: string
      authorEmail?: string
    }>(request)
    if ('error' in parsed) return parsed.error

    const { type = 'reply', content } = parsed.body
    if (!content?.trim()) return badRequest('a message needs content')
    if (type !== 'reply' && type !== 'note') return badRequest('type must be "reply" or "note"')

    const sender = { type: 'agent' as const, name: parsed.body.authorName, email: parsed.body.authorEmail }
    const message =
      type === 'reply'
        ? await helpdesk.reply(number, content, sender)
        : await helpdesk.note(number, content, sender)

    return message ? json({ data: message }, 201) : notFound('ticket')
  })

  // ---- dispatch ------------------------------------------------------------

  return async function handle(request: Request): Promise<Response> {
    const cors = corsHeaders(request, options.cors)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    if (options.tokens?.length) {
      const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      if (!presented || !options.tokens.includes(presented)) {
        return withCors(fail('unauthorized', 'a valid bearer token is required', 401), cors)
      }
    }

    const url = new URL(request.url)
    const pathname = base && url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname

    const matched = router.match(request.method, pathname)
    if (!matched) return withCors(fail('not_found', `no route for ${request.method} ${pathname}`, 404), cors)

    try {
      return withCors(await matched.handler(request, matched.params), cors)
    } catch (error) {
      // The message stays server-side; a stack trace is not a client's business.
      console.error('[helpdeck] api error', error)
      return withCors(fail('internal_error', 'the request could not be completed', 500), cors)
    }
  }
}

function noHelpdesk(): Response {
  return fail('helpdesk_disabled', 'this deployment has no help desk configured', 501)
}

function withCors(response: Response, cors: Record<string, string>): Response {
  if (Object.keys(cors).length === 0) return response
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(cors)) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

export { createRouter } from './router.js'
export type { Params, RouteHandler } from './router.js'
