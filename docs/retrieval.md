# Getting your content in

## Retrieval, and what it costs you to skip embeddings

An index built with no credentials is keyword-only. That is genuinely good at
what support questions are mostly made of: product names, error codes, plan
names, the exact words on your pricing page.

It has one real blind spot. A customer who writes "can I get my money back"
shares no word with a page that says "refund", so keyword search cannot connect
them. There is a test in this repository asserting exactly that, because it is a
limit worth being honest about.

Adding embeddings fixes it, and they can be local:

```bash
# Anything OpenAI-compatible, including Ollama on your own machine.
npx recourse ingest --url https://your-site.com \
  --embed-url http://localhost:11434/v1 --embed-model nomic-embed-text
```

Vectors are stored as int8 rather than float32. A 512-dimension vector is 12KB of
JSON as floats and about 700 bytes quantised, which is the difference between an
index you commit to git and one that needs a database.


## When the index file becomes the problem

The vectors ride inside the index file by default, which is right until the
file is what hurts: it is parsed on every cold start and the vectors are most
of its weight.

```ts
import { ingest } from 'recourse/ingest'
import { pgVectorStore } from '@recourse/store-postgres'

await ingest({ url: 'https://shop.example', vectorStore: pgVectorStore({ pool }) })
```

The index that comes back keeps only the keyword half, so retrieval degrades to
keyword search if the database is unreachable rather than to nothing.

Measured against pgvector at the size that forces the decision, 50,000 chunks
at 768 dimensions:

```
written in 100.7s
table size: 233 MB
first query: 8ms, top hit chunk-42 at 1.0000
warm query p50: 1ms, p95: 1ms
```

One millisecond. The 8ms first query is the HNSW index being read in.

The `1.0000` is worth as much as the timings: the query was the stored vector
for chunk 42 and came back with a cosine of exactly one, so full-precision
floats survive the round trip. The int8 packing inside the index file cannot do
that, which is why the write happens during the build rather than afterwards.

The same 50,000 vectors inside a file would be 38 MB raw and 51 MB once base64
puts them in JSON, before any chunk text, parsed on every cold start.

---

[Back to the README](../README.md)
