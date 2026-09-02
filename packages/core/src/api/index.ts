import type { Store } from '../store/types.js'
import type { CorrectionStore } from '../corrections.js'
import type { Helpdesk } from '../helpdesk/service.js'
import type { KnowledgeBase } from '../knowledge/base.js'
import type { StatusCategory } from '../helpdesk/types.js'
import { corsHeaders, type CorsOptions } from '../server/cors.js'
import { createRouter } from './router.js'
import { badRequest, fail, json, notFound, ok, pageParams, readJson } from './http.js'
import { ADMIN_PAGE } from './admin.js'
import { createMcp, type McpOptions } from './mcp.js'
import { safeEqual } from '../util/compare.js'
import { getLogger } from '../diagnostics.js'

export interface ApiOptions {
  store: Store
  /** Enables the ticket routes. Omit it and they answer 501. */
  helpdesk?: Helpdesk
  /** Enables the source routes, so content can be managed without a deploy. */
  knowledge?: KnowledgeBase
  /**
   * Enables the correction routes, so a wrong answer can be fixed by the person
   * who noticed it. Pass the same store the agent was built with, or the two
   * disagree and a correction written here never reaches an answer.
   */
  corrections?: CorrectionStore
  /**
   * Bearer tokens allowed to call this. Omit it and the API is open, which is
   * only ever right behind your own network.
   */
  tokens?: string[]
  cors?: CorsOptions
  /** Strips a mount prefix, so the API can live under /api/v1 or anywhere. */
  basePath?: string
  /**
   * Serves a small read-only admin page at `/admin`. Off by default: it shows
   * every transcript, so it belongs behind the same auth as the rest of this.
   */
  admin?: boolean
  /**
   * Serves a Model Context Protocol endpoint at `/mcp`.
   *
   * Turns the help desk into tools a coding agent can call, so the gap list and
   * the ticket queue are readable from Claude Desktop or an editor rather than
   * from a dashboard in another tab. Read-only, and behind the same `tokens` as
   * the rest of this.
   *
   * `true` mounts the store-backed tools. Pass an object to add
   * `search_knowledge`, which needs the agent so that a search matches what a
   * customer would actually have been answered from.
   *
   *     mcp: { agent }
   */
  mcp?: boolean | Omit<McpOptions, 'store' | 'helpdesk'>
  /**
   * Called for every request to this API, including the refused ones.
   *
   * Nothing here writes it down. Where an access log belongs is a decision
   * about your infrastructure rather than about this library, and a store that
   * grew its own audit table would be the wrong place for it on most
   * deployments.
   *
   * It exists because three separate regimes want the same thing and none of
   * them can be satisfied after the fact: the HIPAA Security Rule asks for a
   * record of who examined systems holding health information, the GDPR asks
   * you to show who accessed personal data, and SOC 2 asks the same question.
   * This endpoint hands back whole transcripts, so it is the one worth
   * recording.
   *
   *     onAccess: (event) => logger.info('recourse.api', event)
   *
   * `actor` names which credential was used without revealing it: the first
   * twelve characters of the token's SHA-256, which is stable across requests.
   * Putting a bearer token in a log file is how they leak.
   */
  onAccess?: (event: AccessEvent) => void | Promise<void>
}

/** One request to the management API, for whoever keeps the access log. */
export interface AccessEvent {
  at: string
  method: string
  path: string
  status: number
  /** A stable fingerprint of the bearer token, never the token. */
  actor?: string
}

/**
 * The paths a person reaches by typing them.
 *
 * Everything else here is called by script, which can set a header. These two
 * are documents the browser fetches by navigating, and a navigation carries no
 * headers of its own, so the only credential they can present is in the URL.
 */
const ADMIN_PAGES = new Set(['/admin', '/admin/preview'])

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

  // Said once, at mount, because the alternative is finding out from somebody
  // else. This serves whole conversations, captured leads and tickets, and
  // without a token it serves them to anybody who guesses the path. Behind a
  // private network that is a reasonable thing to want, which is why this is a
  // warning rather than a refusal.
  if (!options.tokens?.length) {
    getLogger().warn(
      'the management API is mounted with no tokens, so anything that can reach it can ' +
        'read every conversation, lead and ticket. Pass `tokens` unless it is on a network only you can reach.',
    )
  }

  router.get('/health', async () => ok({ status: 'ok', store: store.name }))

  // Model Context Protocol, on the same auth and the same access log as
  // everything else here. A separate endpoint with its own token would be a
  // second thing to rotate and a second thing to forget.
  if (options.mcp) {
    const mcp = createMcp({
      store,
      ...(options.helpdesk ? { helpdesk: options.helpdesk } : {}),
      ...(options.mcp === true ? {} : options.mcp),
    })

    router.post('/mcp', async (request) => {
      const body = await request.text()
      const answer = await mcp.handleText(body)

      // A notification gets no response. Answering one is a protocol error,
      // and 202 with an empty body is what the spec asks for.
      return answer === null ? new Response(null, { status: 202 }) : json(answer, 200)
    })
  }

  if (options.admin) {
    router.get('/admin', async () =>
      new Response(ADMIN_PAGE, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // The page is inline script only, so nothing else needs loading.
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
          // The page may have been opened with the token in its URL, and a
          // Referer would hand that to anything it links to or frames.
          'Referrer-Policy': 'no-referrer',
        },
      }),
    )

    // The preview, on its own page, for one reason: the admin page allows
    // inline script and nothing else, which is what a page showing every
    // transcript should allow. Loading the widget build into it would mean
    // widening that to any same-origin script. An iframe pointed here keeps
    // the strict policy where the transcripts are and puts the loosening on a
    // page that holds nothing.
    router.get('/admin/preview', async (request) => {
      const asked = new URL(request.url).searchParams
      const source = asked.get('src') ?? '/recourse.js'

      // Only the attributes the widget documents, and only from a fixed list.
      // This page reflects a query string into markup, so what may appear is
      // decided here rather than by the caller.
      const allowed = [
        'endpoint', 'title', 'subtitle', 'greeting', 'accent', 'theme',
        'suggestions', 'invite', 'feedback', 'copy', 'attachments', 'dictation',
      ]

      const attributes = allowed
        .filter((name) => asked.get(name))
        .map((name) => `data-${name}="${escapeAttribute(asked.get(name) as string)}"`)
        .join('\n    ')

      return new Response(
        `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Widget preview</title>
<style>html,body{margin:0;height:100%;background:transparent}</style></head>
<body>
<script
    src="${escapeAttribute(sameOrigin(source))}"
    ${attributes}
    data-open="true"
    data-persist="false"
    defer
></script>
</body>
</html>`,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Scripts from this origin, because that is the whole job here.
            // Still no third-party anything, and this page has no data on it.
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'",
            // The page may have been opened with the token in its URL, and a
            // Referer would hand that to anything it links to or frames.
            'Referrer-Policy': 'no-referrer',
          },
        },
      )
    })
  }

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

  // ---- knowledge sources ---------------------------------------------------

  /** Said plainly, because the fix is one option rather than a bug. */
  const noCorrections = () =>
    json({ error: { code: 'not_configured', message: 'no correction store is configured on this agent' } }, 501)

  const knowledge = () => options.knowledge

  /**
   * Corrections: what the support team says the answer should have been.
   *
   * On the management API rather than anywhere public, because a correction
   * outranks the documentation. Anyone who can write one can decide what the
   * agent says, which is exactly the authority a support lead needs and exactly
   * the authority a visitor must not have.
   */
  const corrections = () => options.corrections

  router.get('/corrections', async () => {
    const store = corrections()
    return store ? ok(await store.list()) : noCorrections()
  })

  router.post('/corrections', async (request) => {
    const store = corrections()
    if (!store) return noCorrections()

    const parsed = await readJson<{ question?: unknown; answer?: unknown; author?: unknown }>(request)
    if ('error' in parsed) return parsed.error

    const question = typeof parsed.body.question === 'string' ? parsed.body.question.trim() : ''
    const answer = typeof parsed.body.answer === 'string' ? parsed.body.answer.trim() : ''

    // Both, and said plainly. A correction with no question matches nothing and
    // one with no answer would blank an answer that at least used to be wrong
    // in a useful direction.
    if (!question) return badRequest('a correction needs the question that went wrong')
    if (!answer) return badRequest('a correction needs the answer it should have given')

    return json(
      {
        data: await store.add({
          question,
          answer,
          ...(typeof parsed.body.author === 'string' ? { author: parsed.body.author } : {}),
        }),
      },
      201,
    )
  })

  /**
   * Edits one, keeping its id, its createdAt and its author.
   *
   * Partial: a body with only an answer changes only the answer. That is the
   * common case, because the question is the customer's exact wording and the
   * whole point is not to tidy it.
   */
  router.patch('/corrections/:id', async (request, params) => {
    const store = corrections()
    if (!store) return noCorrections()

    // A store is free not to implement this, so say which of the two problems
    // it is rather than answering 404 for a correction that exists.
    if (!store.update) {
      return json(
        { error: { code: 'not_supported', message: 'this correction store cannot edit, only add and remove' } },
        501,
      )
    }

    const parsed = await readJson<{ question?: unknown; answer?: unknown; author?: unknown }>(request)
    if ('error' in parsed) return parsed.error

    const patch: { question?: string; answer?: string; author?: string } = {}
    if (typeof parsed.body.question === 'string') patch.question = parsed.body.question.trim()
    if (typeof parsed.body.answer === 'string') patch.answer = parsed.body.answer.trim()
    if (typeof parsed.body.author === 'string') patch.author = parsed.body.author

    // The same two rules the create route applies, for the same two reasons: a
    // correction with no question matches nothing, and one with no answer
    // blanks an answer that was at least wrong in a useful direction. Checked
    // only for a field that was actually sent, since this is a partial update.
    if (patch.question !== undefined && !patch.question) {
      return badRequest('a correction needs the question that went wrong')
    }
    if (patch.answer !== undefined && !patch.answer) {
      return badRequest('a correction needs the answer it should have given')
    }
    if (Object.keys(patch).length === 0) return badRequest('nothing to change')

    const edited = await store.update(params.id as string, patch)
    return edited ? ok(edited) : notFound('correction')
  })

  router.delete('/corrections/:id', async (_request, params) => {
    const store = corrections()
    if (!store) return noCorrections()

    return (await store.remove(params.id as string)) ? ok({ removed: true }) : notFound('correction')
  })

  router.get('/sources', async (request) => {
    const kb = knowledge()
    if (!kb) return noKnowledge()

    const status = new URL(request.url).searchParams.get('status')
    const page = await kb.listSources(status === 'pending_deletion' ? 'pending_deletion' : 'active')
    return ok(page.items, { pagination: { cursor: page.cursor } })
  })

  router.get('/sources/summary', async () => {
    const kb = knowledge()
    return kb ? ok(await kb.summary()) : noKnowledge()
  })

  router.post('/sources', async (request) => {
    const kb = knowledge()
    if (!kb) return noKnowledge()

    const parsed = await readJson<Parameters<KnowledgeBase['addSource']>[0]>(request)
    if ('error' in parsed) return parsed.error

    try {
      return json({ data: await kb.addSource(parsed.body) }, 201)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'could not add the source')
    }
  })

  router.get('/sources/:id', async (_request, params) => {
    const kb = knowledge()
    if (!kb) return noKnowledge()
    const source = await kb.getSource(params.id as string)
    return source ? ok(source) : notFound('source')
  })

  router.put('/sources/:id', async (request, params) => {
    const kb = knowledge()
    if (!kb) return noKnowledge()

    const parsed = await readJson<Parameters<KnowledgeBase['updateSource']>[1]>(request)
    if ('error' in parsed) return parsed.error

    try {
      const source = await kb.updateSource(params.id as string, parsed.body)
      return source ? ok(source) : notFound('source')
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'could not update the source')
    }
  })

  router.delete('/sources/:id', async (_request, params) => {
    const kb = knowledge()
    if (!kb) return noKnowledge()
    const source = await kb.deleteSource(params.id as string)
    return source ? ok(source) : notFound('source')
  })

  router.post('/sources/:id/restore', async (_request, params) => {
    const kb = knowledge()
    if (!kb) return noKnowledge()
    const source = await kb.restoreSource(params.id as string)
    return source ? ok(source) : notFound('source')
  })

  router.post('/train', async () => {
    const kb = knowledge()
    if (!kb) return noKnowledge()

    try {
      const index = await kb.train()
      return ok({ documents: index.stats.documents, chunks: index.stats.chunks, trainedAt: index.createdAt })
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'training failed')
    }
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

    let presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

    const recorded = async (response: Response): Promise<Response> => {
      if (!options.onAccess) return response

      try {
        await options.onAccess({
          at: new Date().toISOString(),
          method: request.method,
          path: new URL(request.url).pathname,
          status: response.status,
          ...(presented ? { actor: await fingerprint(presented) } : {}),
        })
      } catch (error) {
        // A log that cannot be written must not take the API down with it, and
        // refusing to answer is not the safer failure here.
        getLogger().error('onAccess threw', error)
      }

      return response
    }

    // Inside the try, all of it. Matching a route decodes the path, and a
    // truncated percent escape makes that throw; outside, the throw leaves
    // this function entirely and whoever mounted the API answers instead of
    // the API. A client asking for a path this cannot parse still deserves
    // the shape every other failure here uses.
    try {
      const url = new URL(request.url)
      const pathname = base && url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname

      // Only these two paths, only GET, and only when the page is served at all.
      // A token in a query string is a token in an access log and in somebody's
      // browser history, which is the cost of the page being reachable by a
      // person rather than by a script.
      if (!presented && options.admin && request.method === 'GET' && ADMIN_PAGES.has(pathname)) {
        presented = url.searchParams.get('token') ?? undefined
      }

      if (options.tokens?.length) {
        // Read into a const first: a page may now assign `presented` from the
        // query, and a variable that can be reassigned is not narrowed inside
        // the callback below.
        const credential = presented

        // Compared the same way every signature in this library is, rather than
        // with `includes`, which stops at the first wrong character and so takes
        // longer the more of the token is right. This endpoint hands back
        // conversations, leads and tickets, so it is the last place to use a
        // weaker comparison than the webhooks do.
        const allowed = credential ? options.tokens.some((token) => safeEqual(token, credential)) : false

        if (!allowed) {
          // Recorded too. A refused attempt is the entry an access log exists
          // for, and dropping it leaves a log that only ever shows success.
          return recorded(withCors(fail('unauthorized', 'a valid bearer token is required', 401), cors))
        }
      }

      const matched = router.match(request.method, pathname)
      if (!matched) {
        return recorded(withCors(fail('not_found', `no route for ${request.method} ${pathname}`, 404), cors))
      }

      return recorded(withCors(await matched.handler(request, matched.params), cors))
    } catch (error) {
      // The message stays server-side; a stack trace is not a client's business.
      getLogger().error('api error', error)
      return recorded(withCors(fail('internal_error', 'the request could not be completed', 500), cors))
    }
  }
}

/** Attribute values are reflected into markup, so they are escaped as such. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .slice(0, 500)
}

/**
 * A same-origin path, or nothing.
 *
 * The preview names the script to load, and the point of the policy above is
 * that it cannot be somebody else's. A path is allowed, an absolute URL is
 * not, and the policy would refuse it anyway; refusing here as well means the
 * page says so rather than rendering a tag that silently never runs.
 */
function sameOrigin(source: string): string {
  return /^\/[^/\\]/.test(source) ? source : '/recourse.js'
}

/**
 * Which credential, without the credential.
 *
 * Twelve hex characters of a SHA-256 is stable across requests, so an access
 * log can be grouped by who, and reverses to nothing.
 */
async function fingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)]
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function noKnowledge(): Response {
  return fail('knowledge_disabled', 'this deployment manages its sources at build time', 501)
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

export { createHelpPage, type HelpPageOptions } from './helppage.js'
export { createRouter } from './router.js'
export type { Params, RouteHandler } from './router.js'
