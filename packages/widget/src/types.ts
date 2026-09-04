import type { VoiceRuntime } from './call.js'
import type { WidgetStrings } from './strings.js'

export interface WidgetOptions {
  /** The recourse chat endpoint. Required. */
  endpoint: string
  /** Header title. */
  title?: string
  /** One line under the title. */
  subtitle?: string
  /** Shown as the agent's opening message. */
  greeting?: string | string[]
  /**
   * A picture to put above the greeting, on an empty panel.
   *
   * The panel opens larger than anything in it, and a lone sentence in the top
   * corner reads as a page that has not loaded. Given this, the greeting is
   * centred under the image instead, and both go when the first question does.
   *
   * A URL your own site serves. Nothing is fetched from anywhere else, and a
   * transparent PNG is the only kind that works in both colour schemes.
   */
  greetingArt?: string
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
   * Opens on a question carried in the page URL, as `?recourse_q=...`.
   *
   * On by default. The parameter is namespaced precisely so leaving it on is
   * safe: a page that already has `?q=` or `?search=` is untouched, because
   * answering somebody's site search in the chat window is not what they
   * asked for. Pass `false` to ignore the link entirely.
   */
  deepLink?: boolean
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
  /**
   * Every visible word, so the widget can speak the customer's language
   * without a fork. Partial: anything left out keeps its English default.
   */
  strings?: Partial<WidgetStrings>
  /** A copy control under each answer. Off unless the browser has a clipboard. */
  copy?: boolean
  /**
   * A control that asks the last question again, on the last answer only.
   *
   * On unless set to false. It costs a turn each time it is pressed, which is
   * the reason to turn it off, and the reason to leave it on is that the
   * alternative for a customer given a bad answer is retyping the question or
   * leaving.
   */
  retry?: boolean
  /**
   * A control that forgets the conversation, locally and on the server.
   *
   * Best-effort privacy rather than a compliance feature: it deletes the one
   * conversation this tab minted, which is all it can prove ownership of.
   */
  allowDelete?: boolean
  /**
   * A bubble above the launcher, shown once before anyone opens the panel.
   * The most effective single thing for getting a visitor to ask at all.
   */
  invite?: string
  /** Milliseconds before the invite appears. Immediately is ignored as noise. */
  inviteDelay?: number
  /**
   * Lets the visitor attach files. Off unless set, since a widget that offers
   * an upload button against a server that refuses them is worse than no
   * button at all.
   *
   * These caps are a courtesy, so someone learns their file is too big before
   * they wait for it to upload. The server checks everything again.
   */
  attachments?: AttachmentOptions | boolean
  /**
   * Lets the visitor dictate instead of typing. Off unless set.
   *
   * Hidden entirely where the browser has no speech recognition, rather than
   * shown as a button that does nothing.
   */
  dictation?: DictationSettings | boolean
  /**
   * A call button, pointed at the endpoint that mints a signed URL. Off unless
   * a host says otherwise: it is the one feature here that costs them money
   * per use, so it is never on by accident.
   */
  call?:
    | string
    | {
        endpoint: string
        /**
         * Who carries the call. `vendor` hands it to a voice service through a
         * signed URL your server mints. `hosted` keeps it on your own socket,
         * where your persona, classifier and procedures still govern the
         * answer, and the transcriber and voice are yours to run.
         */
        transport?: 'vendor' | 'hosted'
        load?: () => Promise<VoiceRuntime>
      }
}

export interface DictationSettings {
  /** BCP-47 tag. Defaults to the page's `lang`. */
  lang?: string
  /**
   * Requires the audio to stay on the device. On by default; see the widget
   * README for what turning it off means.
   */
  processLocally?: boolean
  /** Permits the browser's default when on-device recognition is unavailable. */
  allowCloudFallback?: boolean
}

export interface AttachmentOptions {
  /** Largest single file, in bytes. 10MB by default. */
  maxBytes?: number
  /** Most files on one message. Four by default. */
  maxCount?: number
  /** Media types offered in the picker, and checked before sending. */
  accept?: string[]
}

export type ClientActionHandler = (input: Record<string, unknown>) => unknown | Promise<unknown>

/** Everything the host page can subscribe to. */
export interface WidgetEvents {
  /** The visitor sent a message. */
  message: { text: string }
  /** The agent finished replying. */
  response: { text: string; sources: SourceRef[] }
  /** A server action ran. */
  action: { name: string; status: string; input?: Record<string, unknown>; result?: unknown }
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
  | {
      type: 'action'
      name: string
      status: 'running' | 'done' | 'failed'
      summary?: string
      /** Present only where the server was told to send them. */
      input?: Record<string, unknown>
      result?: unknown
    }
  /**
   * The model thinking, on a deployment that asked the server to send it.
   *
   * Only ever arrives where the server was told to send it, which is not the
   * open web: reasoning is the model restating its own instructions. Shown
   * where the answer is not yet, and replaced by the answer when it starts.
   */
  | { type: 'reasoning'; text: string }
  | {
      type: 'client-action'
      id: string
      name: string
      input: Record<string, unknown>
      payload?: Record<string, unknown>
    }
  | { type: 'ui'; kind: string; id: string; data: Record<string, unknown> }
  | { type: 'suggestions'; items: string[]; pickOne?: boolean }
  | { type: 'captured'; kind: 'lead' | 'data'; name: string; values: Record<string, unknown> }
  | { type: 'handoff'; ticketId?: string; message: string }
  | { type: 'notice'; message: string }

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /**
   * Sent to the agent but never drawn.
   *
   * For a question the page asked on the visitor's behalf, where showing it
   * would put words in their mouth that they never typed.
   */
  unseen?: boolean
  sources?: SourceRef[]
  /**
   * The `[n]` each entry of `sources` was cited by, in the same order.
   *
   * Kept because the list shown is only the cited subset, so a position in it
   * is not the number the answer used. One page can be cited more than once,
   * which is why each entry is a list.
   */
  citedAs?: number[][]
  /** Files sent with this message. Kept for the chips under the bubble. */
  attachments?: OutgoingAttachment[]
}

export interface OutgoingAttachment {
  name: string
  mimeType: string
  dataUrl: string
  bytes: number
}

/**
 * The parts of a running widget a page may change.
 *
 * Deliberately a short list. Anything that decides how the widget talks to the
 * server, what it may upload or who it says it is belongs in the options it
 * was built with, where it can be reasoned about once; a page changing those
 * at runtime is a page that can change them from anywhere.
 */
export interface Chrome {
  title: string
  subtitle: string
  placeholder: string
  footnote: string
  /**
   * What the agent says before anybody has typed anything.
   *
   * Several of them arrive as separate messages rather than one paragraph,
   * because that is what a person opening a chat reads: a greeting, then what
   * this agent can actually help with. One long block is a wall.
   */
  greeting: string | string[]
  suggestions: string[]
}
