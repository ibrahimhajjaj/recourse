/**
 * Everything, for a Node or Bun server.
 *
 * **This entry point is not safe to import in a Worker or on the edge.** It
 * re-exports `ingest` and the local-file source, which read from disk and
 * therefore import `node:fs`. A bundler targeting a runtime without Node
 * built-ins will refuse it.
 *
 * On those runtimes import the subpaths instead, none of which touch the
 * filesystem: `helpdeck/server`, `helpdeck/agent`, `helpdeck/models`,
 * `helpdeck/actions`, `helpdeck/channels`, `helpdeck/safety`, `helpdeck/store`.
 * `examples/worker` does exactly that and asserts it in its build.
 */

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
  notionSource,
  scrape,
  parsePdf,
  parseDocx,
} from './sources/index.js'
export type {
  WebsiteSourceOptions,
  FilesSourceOptions,
  QnaPair,
  QnaSourceOptions,
  NotionSourceOptions,
  DocumentParser,
  ParserRegistry,
} from './sources/index.js'

export {
  createRetriever,
  fuse,
  indexVectorStore,
  type RetrieverOptions,
  type VectorStore,
  type VectorHit,
  type VectorSearchOptions,
} from './retrieve/index.js'
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
  Ticket,
  TicketCustomer,
  TicketMessage,
  TicketMessageSender,
  TicketFilter,
} from './helpdesk/index.js'

export { createApiHandler, type ApiOptions } from './api/index.js'
export { createHelpPage, type HelpPageOptions } from './api/helppage.js'

export { runCampaign, renderTemplate, validateRecipients } from './outbound/index.js'
export type {
  CampaignOptions,
  CampaignRecipient,
  CampaignResult,
  CampaignProgress,
} from './outbound/index.js'

export { createWebhooks, signWebhook, verifyWebhook } from './webhooks/index.js'
export type { Webhooks, WebhookOptions, WebhookEndpoint, WebhookEvent, WebhookDelivery } from './webhooks/index.js'

export {
  whatsappChannel,
  slackChannel,
  messengerChannel,
  instagramChannel,
  telegramChannel,
  discordChannel,
  teamsChannel,
  voiceChannel,
  gatherVoiceChannel,
  createVoiceSession,
  createSpeechCache,
  elevenLabsVoice,
  openAiCompatibleVoice,
  speechRoute,
  elevenLabsToolRoute,
  elevenLabsSystemPrompt,
  buildTwiml,
  buildHandoffTwiml,
  toSpeech,
  createSentenceBuffer,
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
  TeamsOptions,
  VoiceAnswerOptions,
  GatherVoiceOptions,
  Voice,
  SpeechCache,
  ElevenLabsVoiceOptions,
  OpenAiVoiceOptions,
  ElevenLabsToolOptions,
  VoiceSessionOptions,
  VoiceCallState,
  InboundVoiceMessage,
  OutboundVoiceMessage,
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
  liveChat,
  transferToPhone,
  salesforceCases,
} from './actions/index.js'
export type {
  Action,
  ActionContext,
  ActionField,
  ActionInput,
  ActionResult,
  Contact,
  EscalationRequest,
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
  LiveChatOptions,
  TransferToPhoneOptions,
  SalesforceCaseOptions,
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
export {
  validateAttachments,
  sanitiseName,
  decodedSize,
  isImage,
  DEFAULT_ALLOWED_TYPES,
  DEFAULT_MAX_BYTES,
  type Attachment,
  type AttachmentPolicy,
} from './attachments.js'
export { prepareAttachments, type PrepareOptions, type PreparedAttachments } from './attachments-prepare.js'
export {
  createClassifier,
  blocks,
  phraseRule,
  DEFAULT_CATEGORIES,
  THRESHOLDS,
  // Renamed at the top level: `Decision` is already a procedure's branch
  // choice, and two of them in one namespace helps nobody.
  type Action as SafetyAction,
  type Decision as SafetyDecision,
  type CategoryPolicy,
  type ClassifierPolicy,
  type Sensitivity,
  type Signal,
} from './safety/index.js'
export { models, embedders, type OpenAICompatibleOptions } from './models.js'
export { upstashRateLimiter, redisRateLimiter, type RedisLike } from './server/ratelimit-shared.js'
export type { RateLimiter, RateLimitResult } from './server/ratelimit.js'
