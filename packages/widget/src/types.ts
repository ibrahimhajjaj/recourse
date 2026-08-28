export interface WidgetOptions {
  /** The helpdeck chat endpoint. Required. */
  endpoint: string
  /** Header title. */
  title?: string
  /** One line under the title. */
  subtitle?: string
  /** Shown as the agent's opening message. */
  greeting?: string
  /** Clickable starter questions. */
  suggestions?: string[]
  /** Accent colour. Anything CSS accepts. */
  accent?: string
  /** Corner to dock the launcher in. */
  position?: 'bottom-right' | 'bottom-left'
  /** `auto` follows the visitor's system setting. */
  theme?: 'light' | 'dark' | 'auto'
  /** Where to mount. Defaults to a floating launcher on document.body. */
  target?: HTMLElement
  /** Start with the panel open. */
  open?: boolean
  /** Remember the conversation for the tab's lifetime. */
  persist?: boolean
  /**
   * Handlers for actions the agent asks the browser to run. The key is the
   * action name configured on the server.
   */
  actions?: Record<string, ClientActionHandler>
  /** Identifies a signed-in visitor. The hash must be produced server-side. */
  userId?: string
  userHash?: string
  /** Extra details about the visitor, shown to the agent. */
  contact?: Record<string, string | number | boolean>
  /** Show thumbs up and down under each answer. */
  feedback?: boolean
}

export type ClientActionHandler = (input: Record<string, unknown>) => unknown | Promise<unknown>

/** Everything the host page can subscribe to. */
export interface WidgetEvents {
  /** The visitor sent a message. */
  message: { text: string }
  /** The agent finished replying. */
  response: { text: string; sources: SourceRef[] }
  /** A server action ran. */
  action: { name: string; status: string }
  /** Details were captured from the conversation. */
  captured: { kind: 'lead' | 'data'; name: string; values: Record<string, unknown> }
  /** The conversation was handed to a person. */
  handoff: { ticketId?: string; message: string }
  /** Something went wrong. */
  error: { message: string }
  open: Record<string, never>
  close: Record<string, never>
}

export type EventName = keyof WidgetEvents

export interface SourceRef {
  title: string
  url?: string
  section?: string
}

export type StreamFrame =
  | { type: 'sources'; sources: SourceRef[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason?: string }
  | { type: 'error'; message: string }
  | { type: 'action'; name: string; status: 'running' | 'done' | 'failed'; summary?: string }
  | { type: 'client-action'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'ui'; kind: string; id: string; data: Record<string, unknown> }
  | { type: 'suggestions'; items: string[] }
  | { type: 'captured'; kind: 'lead' | 'data'; name: string; values: Record<string, unknown> }
  | { type: 'handoff'; ticketId?: string; message: string }

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: SourceRef[]
}
