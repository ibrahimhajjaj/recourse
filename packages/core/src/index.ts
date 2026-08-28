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
export { serializeIndex, parseIndex } from './knowledge/serialize.js'
export { tokenize } from './knowledge/tokenize.js'

export { markdownChunker, type MarkdownChunkerOptions } from './chunk/index.js'
export { websiteSource, filesSource, textSource, scrape } from './sources/index.js'
export type { WebsiteSourceOptions, FilesSourceOptions } from './sources/index.js'

export { createRetriever, fuse, type RetrieverOptions } from './retrieve/index.js'
export { gatewayEmbedder, canReachGateway, type GatewayEmbedderOptions } from './embed.js'

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
