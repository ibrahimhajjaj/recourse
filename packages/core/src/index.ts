/**
 * helpdeck: a support agent that learns your site and plugs into any app.
 *
 * Two moving parts. `ingest` turns content into a knowledge index at build
 * time; `createChatHandler` serves answers from it at request time. Everything
 * between them is an interface with a default you can replace.
 */

export type {
  Chunk,
  Chunker,
  Document,
  Embedder,
  IndexStats,
  KeywordIndex,
  KnowledgeIndex,
  Match,
  Message,
  ProgressEvent,
  RetrieveOptions,
  Retriever,
  Source,
  SourceContext,
  SourceRef,
  StreamFrame,
  VectorIndex,
} from './types.js'

export {
  createAgent,
  citedOnly,
  type AgentOptions,
  type Answer,
  type StreamOptions,
} from './agent.js'
export { ingest, writeIndex, type IngestOptions } from './ingest.js'

export { buildIndex, type BuildOptions } from './knowledge/build.js'
export { createKnowledgeBase } from './knowledge/base.js'
export type { KnowledgeBase, KnowledgeBaseOptions, AddSourceInput } from './knowledge/base.js'
export { newSourceId, validateSource } from './knowledge/records.js'
export type { SourceRecord, SourceType, SourceStatus, SourcesSummary } from './knowledge/records.js'
export { serializeIndex, parseIndex } from './knowledge/serialize.js'
export { tokenize } from './knowledge/tokenize.js'

export { markdownChunker, type MarkdownChunkerOptions } from './chunk/index.js'
export {
  websiteSource,
  filesSource,
  textSource,
  qnaSource,
  scrape,
  parsePdf,
  parseDocx,
} from './sources/index.js'
export type {
  WebsiteSourceOptions,
  FilesSourceOptions,
  QnaPair,
  QnaSourceOptions,
  DocumentParser,
  ParserRegistry,
} from './sources/index.js'

export { createRetriever, fuse, type RetrieverOptions } from './retrieve/index.js'
export { createEmbedder, canReachGateway, type EmbedderOptions } from './embed.js'

export {
  signIdentity,
  verifyIdentity,
  resolveIdentity,
  type IdentityOptions,
  type IdentityClaim,
} from './identity.js'

export {
  defineProcedure,
  renderProcedures,
  resolveVariables,
  referencedActions,
  usableProcedures,
  unlockedBy,
} from './procedures/index.js'
export type { Procedure, Step, Decision, Branch, VariableScope } from './procedures/index.js'

export {
  createHelpdesk,
  DEFAULT_STATUSES,
  defaultStatusFor,
  validateStatuses,
  routeTicket,
  evaluateTriggers,
  defaultViews,
  assignTicket,
  loadOf,
  STATUS_CATEGORIES,
  RESOLVED_CATEGORIES,
} from './helpdesk/index.js'
export type {
  Helpdesk,
  HelpdeskOptions,
  OpenTicketInput,
  RoutingRule,
  RoutingCondition,
  Trigger,
  TriggerCondition,
  TriggerAction,
  SavedView,
  AssignmentAlgorithm,
  Availability,
  StatusCategory,
  TicketStatus,
  Team,
  Ticket as HelpdeskTicket,
  TicketCustomer,
  TicketMessage,
  TicketMessageSender,
  TicketFilter,
} from './helpdesk/index.js'

export { createApiHandler, type ApiOptions } from './api/index.js'

export { createWebhooks, signWebhook, verifyWebhook } from './webhooks/index.js'
export type { Webhooks, WebhookOptions, WebhookEndpoint, WebhookEvent, WebhookDelivery } from './webhooks/index.js'

export {
  whatsappChannel,
  slackChannel,
  messengerChannel,
  instagramChannel,
  telegramChannel,
  discordChannel,
  twilioChannel,
  emailChannel,
  parseCommonEmail,
  stripQuoted,
  verifyMeta,
  verifySlack,
  verifyTwilio,
  signMeta,
  signSlack,
  signTwilio,
} from './channels/index.js'
export type {
  WhatsAppOptions,
  SlackOptions,
  MetaMessagingOptions,
  TelegramOptions,
  DiscordOptions,
  TwilioOptions,
  EmailOptions,
  InboundEmail,
  ChannelBase,
  InboundMessage,
} from './channels/index.js'

export { memoryStore, fileStore, computeStats, paginate } from './store/index.js'
export type {
  Store,
  Conversation,
  StoredMessage,
  Lead,
  ListOptions,
  Page,
  Stats,
  Channel,
  MemoryStoreOptions,
  FileStoreOptions,
} from './store/index.js'

export {
  defineAction,
  actionsToTools,
  fieldsToSchema,
  collectLeads,
  collectData,
  escalate,
  webSearch,
  httpAction,
  clientAction,
  suggestedMessages,
  customButton,
  customForm,
  formSchema,
  slackNotify,
  scheduleMeeting,
  stripeBilling,
  shopifyOrders,
} from './actions/index.js'
export type {
  Action,
  ActionContext,
  ActionField,
  ActionInput,
  ActionResult,
  Contact,
  Ticket,
  CollectLeadsOptions,
  CollectDataOptions,
  EscalateOptions,
  WebSearchOptions,
  HttpActionOptions,
  ClientActionOptions,
  SuggestionsOptions,
  CustomButtonOptions,
  CustomFormOptions,
  FormField,
  SlackNotifyOptions,
  BookingOptions,
  StripeOptions,
  ShopifyOptions,
} from './actions/index.js'

export {
  knowledgeTool,
  createKnowledgeSearch,
  type KnowledgeToolOptions,
  type KnowledgePassage,
} from './tool.js'

export {
  createChatHandler,
  buildInstructions,
  toSourceRefs,
  type ChatHandlerOptions,
  type ConversationEvent,
  type PersonaOptions,
  type CorsOptions,
  type RateLimitOptions,
} from './server/index.js'
