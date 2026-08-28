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
}

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

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: SourceRef[]
}
