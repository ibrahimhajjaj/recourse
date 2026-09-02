export { createChatHandler, agentFor, type ChatHandlerOptions, type ConversationEvent } from './handler.js'
export { createOpenAiHandler, type OpenAiHandlerOptions } from './openai.js'
export {
  buildInstructions,
  toSourceRefs,
  retrievalQuery,
  contextualQuery,
  type PersonaOptions,
  type Tone,
} from './prompt.js'
export { corsHeaders, type CorsOptions } from './cors.js'
// Re-exported here so a generated route needs one import line rather than two:
// picking the model is server-side configuration like everything else on this
// entry point.
export { models, embedders, type EnvironmentLike } from '../models.js'
export {
  createRateLimiter,
  callerKey,
  type RateLimitOptions,
  type RateLimiter,
  type RateLimitResult,
} from './ratelimit.js'
export {
  upstashRateLimiter,
  redisRateLimiter,
  type UpstashRateLimitOptions,
  type RedisRateLimitOptions,
  type RedisLike,
} from './ratelimit-shared.js'
export {
  uploadRoute,
  uploadUrlRoute,
  downloadRoute,
  DEFAULT_UPLOAD_MAX_BYTES,
  type UploadRouteOptions,
  type UploadUrlRouteOptions,
} from './upload.js'
export { countryFrom, consented } from './country.js'
