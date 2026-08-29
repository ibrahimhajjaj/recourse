/**
 * Object storage through a Cloudflare R2 binding.
 *
 * On a Worker this is the better half of the seam: the request never leaves
 * Cloudflare's network, there is no signature to compute, and there are no
 * credentials in the environment to leak. A binding is an object handed to
 * your Worker, not a URL and a secret.
 *
 * What it cannot do is sign a URL, because the binding API has no such method.
 * So a deployment that wants browsers to upload straight to the bucket needs
 * S3 credentials as well, and `s3.ts` is where those go.
 *
 * The binding is described structurally rather than imported from
 * `@cloudflare/workers-types`, for the same reason the D1 store is: a package
 * consumers install should not require types for a platform most of them are
 * not on.
 */

import type {
  Blobs,
  BlobContent,
  PutOptions,
  SignedUrlOptions,
  StoredBlob,
} from './blobs.js'

/** The subset of `R2Object` this uses. */
export interface R2ObjectLike {
  key: string
  size: number
  etag?: string
  httpMetadata?: { contentType?: string } | undefined
  customMetadata?: Record<string, string> | undefined
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>
}

/** The subset of `R2Bucket` this uses. */
export interface R2Like {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | null,
    options?: {
      httpMetadata?: { contentType?: string }
      customMetadata?: Record<string, string>
    },
  ): Promise<R2ObjectLike | null>
  get(key: string): Promise<R2ObjectBodyLike | null>
  head(key: string): Promise<R2ObjectLike | null>
  delete(key: string | string[]): Promise<void>
}

export interface R2BindingOptions {
  /**
   * A public base for read URLs, a custom domain on the bucket, or a route on
   * your own Worker that streams objects back.
   *
   * Without one there is no `signedUrl`, because a binding cannot make a link
   * anybody outside the Worker can use.
   */
  publicBase?: string
}

export function r2Blobs(bucket: R2Like, options: R2BindingOptions = {}): Blobs {
  const base = options.publicBase?.replace(/\/+$/, '')

  function describe(object: R2ObjectLike): StoredBlob {
    const filename = object.customMetadata?.filename
    return {
      key: object.key,
      size: object.size,
      mimeType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      ...(object.etag ? { etag: object.etag } : {}),
      ...(filename ? { filename } : {}),
    }
  }

  const blobs: Blobs = {
    name: 'r2',

    async put(key, body, putOptions: PutOptions = {}) {
      const written = await bucket.put(key, body as unknown as ArrayBufferView, {
        httpMetadata: { contentType: putOptions.mimeType ?? 'application/octet-stream' },
        customMetadata: {
          ...putOptions.metadata,
          ...(putOptions.filename ? { filename: putOptions.filename } : {}),
        },
      })

      // A null return is a failed precondition, not a thrown error, which is
      // easy to miss and leaves a key that reads back as missing.
      if (!written) throw new Error(`could not store "${key}": R2 refused the write`)
      return describe(written)
    },

    async get(key): Promise<BlobContent | null> {
      const object = await bucket.get(key)
      if (!object) return null
      return { ...describe(object), bytes: new Uint8Array(await object.arrayBuffer()) }
    },

    async head(key) {
      const object = await bucket.head(key)
      return object ? describe(object) : null
    },

    async delete(key) {
      await bucket.delete(key)
    },
  }

  if (base) {
    blobs.signedUrl = async (key: string, _options?: SignedUrlOptions) =>
      `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
  }

  return blobs
}
