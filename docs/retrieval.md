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
npx @recourse-ai/core ingest --url https://your-site.com \
  --embed-url http://localhost:11434/v1 --embed-model nomic-embed-text
```

Vectors are stored as int8 rather than float32. A 512-dimension vector is 12KB of
JSON as floats and about 700 bytes quantised, which is the difference between an
index you commit to git and one that needs a database.


## What a folder can be made of

`filesSource` reads a directory into the index. Markdown and text need nothing.
Everything else needs a reader, and they are optional packages rather than
dependencies, because most people ingest a website and should not download a PDF
engine to do it.

| You have | Install |
| --- | --- |
| `.pdf` | `npm install pdfjs-dist` |
| `.docx` | `npm install mammoth` |
| `.pptx` `.ppt` `.xlsx` `.ods` `.odp` `.odt` `.doc` `.rtf` `.epub` `.csv` | `npm install @firecrawl/anydoc` |

A missing reader says which package to install rather than throwing a module
error, so a folder with one spreadsheet in it does not fail as a mystery.

PDFs and Word files keep readers written in JavaScript on purpose. The rest go
through a compiled binary, which is faster and covers far more, but a knowledge
base should not need a platform-specific download to read the two formats
everybody has.

`.csv` is readable but is not scanned for by default. A folder almost always has
a CSV in it that is data rather than documentation, and quietly indexing an
export of every customer is a surprise nobody asked for. Name it and it is read:

```ts
import { filesSource } from '@recourse-ai/core'

filesSource({ directory: './docs', extensions: ['.md', '.csv'] })
```

**A scanned PDF is photographs.** There is no text in it to extract, so it
indexes as nothing and says so in the logs rather than leaving you with an empty
index and an agent you think is broken. Reading one needs OCR, which is a
decision for whoever owns the documents rather than a default.

## Rebuilding without paying for the whole site again

Pass the index you are replacing and a rebuild does the work twice over only
where something actually changed:

```ts
import { buildIndex, websiteSource } from '@recourse-ai/core'
import previous from './knowledge.json' with { type: 'json' }

const index = await buildIndex({
  sources: [websiteSource({ url: 'https://shop.example' })],
  embedder,
  previous,
})
```

Two savings, at two different stages.

**Pages nobody changed are not read.** A sitemap gives a `<lastmod>` per URL,
and the sitemap is something we already download. When the date on a page is
the one recorded during the build being replaced, the page is not fetched at
all and its chunks come straight out of the old index. On a four hundred page
site shipping one edit, that is one page read instead of four hundred.

**Text that survived is not embedded again.** Whatever does get read is matched
chunk by chunk against the old index, and a chunk whose indexed text is
byte-for-byte what it was keeps its vector. Stricter than "same page": an edited
paragraph is re-embedded, and so is one whose heading moved, because the heading
is part of what was embedded.

The first only applies where a site publishes dates. Without them there is no
signal, everything is read, and the second saving still applies. Guessing would
freeze a site's content in the index for ever, which is a worse failure than a
bill, so nothing is skipped without the site having said so.

A page the old index has no chunks for is always read, however old its date. It
has nothing to carry over, and trusting the date would quietly drop it.

Dates are compared as opaque strings, exactly as the sitemap wrote them. A site
that reformats its timestamps without changing its content will be read again in
full once, and settle after that.

## When the index file becomes the problem

The vectors ride inside the index file by default, which is right until the
file is what hurts: it is parsed on every cold start and the vectors are most
of its weight.

```ts
import { ingest } from '@recourse-ai/core/ingest'
import { pgVectorStore } from '@recourse-ai/store-postgres'

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

## The same index, as a page people can search

The index that answers the chat can also serve a plain help centre, so somebody
who would rather read than ask has something to read.

```ts
import { createHelpPage } from '@recourse-ai/core/api'

export const GET = createHelpPage({
  index,
  business: 'Lumen Coffee',
  // Offers the chat widget when a search finds nothing good.
  chatEndpoint: '/api/chat',
})
```

One route, server-rendered, no build step and no client framework. It searches
the same index with the same ranking the agent uses, which is the point: a
question that fails here would have failed in the chat too, and you can see it
without opening a conversation.

---

[Back to the README](../README.md)
