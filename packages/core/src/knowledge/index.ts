export { buildIndex, type BuildOptions } from './build.js'
export { createKnowledgeBase, type KnowledgeBase, type KnowledgeBaseOptions, type AddSourceInput } from './base.js'
export {
  newSourceId,
  validateSource,
  type SourceRecord,
  type SourceType,
  type SourceStatus,
  type SourcesSummary,
} from './records.js'
export { serializeIndex, parseIndex } from './serialize.js'
export { buildKeywordIndex, searchKeyword, type KeywordHit } from './bm25.js'
export { buildVectorIndex, searchVector, normalize, type VectorHit } from './vector.js'
export { tokenize } from './tokenize.js'
