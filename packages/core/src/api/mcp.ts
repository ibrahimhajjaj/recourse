/**
 * The help desk as tools a coding agent can call.
 *
 * The support data worth reading is already here: which questions nobody could
 * answer, what a customer actually said, which tickets are open. It is behind
 * a REST API, which means somebody writes a script, or opens a dashboard in
 * another tab and copies things out of it.
 *
 * Model Context Protocol is the same data where the work happens. A support
 * lead asks Claude "what are people asking that we cannot answer?" and gets the
 * gap list; an engineer fixing a bug asks "what did the customer on ticket 412
 * actually say?" without leaving the editor. It is one authenticated endpoint
 * speaking JSON-RPC 2.0 over HTTP, so there is no process to run and no
 * transport to configure.
 *
 * Read-only. Every tool here answers a question, and none of them change
 * anything: an agent that can close a customer's ticket because a model
 * misread a sentence is a worse trade than opening the dashboard.
 */

import type { Store } from '../store/types.js'
import type { Helpdesk } from '../helpdesk/service.js'
import type { Agent } from '../agent.js'

/**
 * Protocol revisions this speaks, newest first.
 *
 * The client says which it wants and gets that one back when it is on the
 * list, which is how a spec that revises stays compatible with clients that
 * have not. Anything unrecognised is answered with the newest rather than
 * refused, because a version mismatch that closes the connection is a worse
 * failure than one that negotiates down.
 */
export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

export interface McpOptions {
  store: Store
  /** Enables the ticket tools. Without it they are not listed at all. */
  helpdesk?: Helpdesk
  /**
   * Enables `search_knowledge`, which is retrieval on its own.
   *
   * The agent is taken rather than an index so the search matches what a
   * customer would actually get, thresholds and all.
   */
  agent?: Pick<Agent, 'search'>
  /** Shown to the client on connect. */
  serverName?: string
  version?: string
}

interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run(args: Record<string, unknown>): Promise<unknown>
}

/** JSON-RPC error codes this uses, from the spec. */
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

/**
 * Handles one JSON-RPC request and hands back a body to send, or `null`.
 *
 * `null` is a notification: the spec says a notification gets no response, and
 * the caller answers 202 with an empty body. Returning it rather than a
 * Response keeps this transport-agnostic, so the same handler serves a Worker,
 * a Node server, or a test.
 */
export function createMcp(options: McpOptions) {
  const tools = buildTools(options)
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  async function handle(body: unknown): Promise<Record<string, unknown> | null> {
    if (!isRecord(body)) return error(null, INVALID_REQUEST, 'a request must be a JSON object')

    const id = (body.id ?? null) as string | number | null
    const method = body.method

    if (typeof method !== 'string') return error(id, INVALID_REQUEST, 'no method')

    // Notifications carry no id and get no answer. `notifications/initialized`
    // is the one every client sends, and answering it is a protocol error.
    if (method.startsWith('notifications/')) return null

    switch (method) {
      case 'initialize': {
        const asked = isRecord(body.params) ? body.params.protocolVersion : undefined
        const version =
          typeof asked === 'string' && (MCP_PROTOCOLS as readonly string[]).includes(asked)
            ? asked
            : MCP_PROTOCOLS[0]

        return result(id, {
          protocolVersion: version,
          serverInfo: { name: options.serverName ?? 'helpdeck', version: options.version ?? '0.1.0' },
          capabilities: { tools: { listChanged: false } },
        })
      }

      case 'ping':
        return result(id, {})

      case 'tools/list':
        return result(id, {
          tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        })

      case 'tools/call': {
        const params = isRecord(body.params) ? body.params : {}
        const name = params.name
        if (typeof name !== 'string') return error(id, INVALID_PARAMS, 'tools/call needs a name')

        const tool = byName.get(name)
        if (!tool) return error(id, INVALID_PARAMS, `no tool called "${name}"`)

        const args = isRecord(params.arguments) ? params.arguments : {}

        try {
          const value = await tool.run(args)
          return result(id, { content: [{ type: 'text', text: render(value) }] })
        } catch (thrown) {
          // A tool that fails is a result, not a protocol error: the model is
          // meant to read it and say something useful, which it cannot do with
          // a JSON-RPC error it never sees.
          const why = thrown instanceof Error ? thrown.message : String(thrown)
          return result(id, { content: [{ type: 'text', text: why }], isError: true })
        }
      }

      default:
        return error(id, METHOD_NOT_FOUND, `unknown method "${method}"`)
    }
  }

  return {
    handle,
    /** The tool names on offer, which depends on what was configured. */
    get toolNames(): string[] {
      return tools.map((tool) => tool.name)
    },
    /** Parses a request body and handles it, for a transport that has text. */
    async handleText(text: string): Promise<Record<string, unknown> | null> {
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        return error(null, PARSE_ERROR, 'not valid JSON')
      }
      return handle(body)
    },
  }
}

export type Mcp = ReturnType<typeof createMcp>

function buildTools(options: McpOptions): Tool[] {
  const { store, helpdesk, agent } = options
  const tools: Tool[] = []

  const limitOf = (args: Record<string, unknown>, fallback = 20) => {
    const asked = Number(args.limit ?? fallback)
    return Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 100) : fallback
  }

  if (agent) {
    tools.push({
      name: 'search_knowledge',
      description:
        'Search the support knowledge base and return the passages a customer asking this would be answered from. ' +
        'Use to check what the agent knows, or to find the page that documents something.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The question, in the words a customer would use.' } },
        required: ['query'],
        additionalProperties: false,
      },
      async run(args) {
        const query = String(args.query ?? '')
        if (!query.trim()) throw new Error('query is required')

        const matches = await agent.search(query)
        return matches.map((match) => ({
          title: match.chunk.title,
          url: match.chunk.url,
          score: Number(match.score.toFixed(4)),
          text: match.chunk.text.slice(0, 1200),
        }))
      },
    })
  }

  tools.push({
    name: 'list_answer_gaps',
    description:
      'The questions customers asked that the agent could not answer, most frequent first. ' +
      'This is the list of documentation to go and write. Use when asked what is missing or what to add.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many to return. Default 20.' } },
      additionalProperties: false,
    },
    async run(args) {
      const stats = await store.stats()
      return {
        unansweredTurns: stats.unanswered,
        conversations: stats.conversations,
        gaps: stats.topGaps.slice(0, limitOf(args)),
      }
    },
  })

  tools.push({
    name: 'support_stats',
    description:
      'How the support agent has been doing: conversations, unanswered turns, thumbs, channels, ' +
      'countries, which actions ran, daily activity and active users.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'ISO timestamp. Only count activity after it.' },
        until: { type: 'string', description: 'ISO timestamp. Only count activity before it.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      return store.stats({
        ...(typeof args.since === 'string' ? { since: args.since } : {}),
        ...(typeof args.until === 'string' ? { until: args.until } : {}),
      })
    },
  })

  tools.push({
    name: 'list_conversations',
    description:
      'Recent customer conversations, newest first. Filter to the ones the agent could not answer with ' +
      'unansweredOnly, or to a single channel.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many to return. Default 20.' },
        channel: { type: 'string', description: 'web, email, whatsapp, slack, sms, phone, api.' },
        unansweredOnly: { type: 'boolean', description: 'Only conversations with a turn nobody could answer.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const page = await store.listConversations({
        limit: limitOf(args),
        ...(typeof args.channel === 'string' ? { channel: args.channel } : {}),
        ...(args.unansweredOnly === true ? { unansweredOnly: true } : {}),
      })
      return page.items
    },
  })

  tools.push({
    name: 'get_conversation',
    description: 'Everything said in one conversation, so you can read what the customer actually asked.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The conversation id.' } },
      required: ['id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = String(args.id ?? '')
      const thread = await store.getConversation(id)
      if (!thread) throw new Error(`no conversation called "${id}"`)

      return {
        conversation: thread.conversation,
        messages: thread.messages.map((message) => ({
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          ...(message.unanswered ? { unanswered: true } : {}),
          ...(message.feedback ? { feedback: message.feedback } : {}),
        })),
      }
    },
  })

  if (helpdesk) {
    tools.push({
      name: 'list_tickets',
      description: 'Tickets in the help desk queue. Filter by status category or assignee.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many to return. Default 20.' },
          status: { type: 'string', description: 'new, on_you, on_customer, on_hold, closed or cancelled.' },
          assigneeId: { type: 'string', description: 'Only tickets assigned to this person.' },
        },
        additionalProperties: false,
      },
      async run(args) {
        const page = await store.listTickets({
          limit: limitOf(args),
          ...(typeof args.status === 'string' ? { statusCategory: args.status as never } : {}),
          ...(typeof args.assigneeId === 'string' ? { assigneeId: args.assigneeId } : {}),
        })
        return page.items
      },
    })

    tools.push({
      name: 'get_ticket',
      description: 'One ticket and the messages on it, by its number.',
      inputSchema: {
        type: 'object',
        properties: { ticketNumber: { type: 'number', description: 'The ticket number.' } },
        required: ['ticketNumber'],
        additionalProperties: false,
      },
      async run(args) {
        const number = Number(args.ticketNumber)
        if (!Number.isFinite(number)) throw new Error('ticketNumber must be a number')

        const ticket = await store.getTicket(number)
        if (!ticket) throw new Error(`no ticket numbered ${number}`)

        const messages = await store.listTicketMessages(number, { limit: 50 })
        return { ticket, messages: messages.items }
      },
    })

    tools.push({
      name: 'search_tickets',
      description: 'Free-text search across ticket subjects, descriptions and messages.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for.' },
          limit: { type: 'number', description: 'How many to return. Default 20.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async run(args) {
        const query = String(args.query ?? '')
        if (!query.trim()) throw new Error('query is required')
        return store.searchTickets(query, limitOf(args))
      },
    })
  }

  return tools
}

/**
 * Results go across as text, because that is the one content type every client
 * renders. JSON with newlines in it reads better in a chat window than one
 * long line, and costs nothing.
 */
function render(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function result(id: string | number | null, value: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result: value }
}

function error(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
