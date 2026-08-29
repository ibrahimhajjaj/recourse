/**
 * Object storage: the seam, and the backends that fill it.
 *
 * Imported from `helpdeck/storage` so a deployment that keeps attachments
 * inline never pulls any of it in.
 */

export {
  blobKey,
  memoryBlobs,
  DEFAULT_EXPIRES_IN,
  type Blobs,
  type BlobContent,
  type StoredBlob,
  type PutOptions,
  type SignedUpload,
  type SignedUploadOptions,
  type SignedUrlOptions,
} from './blobs.js'

export { s3Blobs, r2S3Blobs, type S3BlobsOptions } from './s3.js'
export { r2Blobs, type R2Like, type R2ObjectLike, type R2BindingOptions } from './r2-binding.js'

export {
  signReference,
  verifyReference,
  resolveStoredAttachments,
  toBase64,
  DEFAULT_STORED_MAX_BYTES,
  type StoredReference,
  type ResolveOptions,
} from './references.js'

export {
  presign,
  signHeaders,
  sha256Hex,
  encodeRfc3986,
  MAX_EXPIRES_IN,
  UNSIGNED_PAYLOAD,
  EMPTY_SHA256,
  type Credentials,
  type SigningScope,
} from './sigv4.js'
