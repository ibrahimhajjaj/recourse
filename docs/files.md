# Files and images

A visitor can attach a file three ways, and they fail at different sizes.

Inline base64 rides the chat request and needs no storage at all, which is
right for a screenshot and wrong for a 30MB scan: base64 adds a third, and the
whole thing has to fit in one request body. A `url` you already host works and
is never fetched by this server. The third is a bucket.

```ts
import { s3Blobs } from 'recourse/storage'
import { uploadRoute } from 'recourse/server'

const blobs = s3Blobs({
  bucket: 'support-attachments',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`, // or MinIO, or S3
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
})

// POST a file here; it answers { key, token }.
export const POST = uploadRoute({ blobs, secret: process.env.UPLOAD_SECRET! })
```

Then hand the chat handler the same two things, and a message can carry
`{ name, mimeType, key, token }` instead of the bytes:

```ts
import { createChatHandler } from 'recourse/server'

createChatHandler({ index, storage: { blobs, secret: process.env.UPLOAD_SECRET! } })
```

**The token is not decoration.** A key like
`attachments/2026-08-29/…-invoice.pdf` is a guessable shape, and a key arriving
from a browser is a claim, not a credential. Every reference is checked against
an HMAC this deployment issued before anything is read, and a stolen key and a
missing one are told apart by nobody: they get the same sentence back.

For files past your host's request limit (100MB on a Worker, less on some
serverless platforms) `uploadUrlRoute` hands the browser a presigned URL and
the bytes never cross your server. Presigning is implemented here on Web
Crypto, so it needs no AWS SDK and works on every runtime; the signature
matches the worked example in Amazon's own documentation, which is what the
test asserts. Two things to know: an R2 presigned URL cannot be used with a
custom domain, and an expired one comes back as a 403 with no CORS headers, so
the browser cannot read the error. Refresh before expiry rather than after.

`recourse doctor` checks the bucket by writing to it, reading it back and
deleting it, because credentials that can list a bucket but not write to it are
the usual mistake and nothing else notices until a customer's upload fails.

---

[Back to the README](../README.md)
