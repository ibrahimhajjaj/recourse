# helpdeck

A customer support agent that learns your own website and answers from it, with
citations. No API keys to create, no database, no vendor.

```bash
npx helpdeck ingest --url https://your-site.com
```

```ts
import { createChatHandler } from 'helpdeck/server'
import knowledge from './helpdeck/knowledge.json'

export const POST = createChatHandler({ index: knowledge })
```

Full documentation: https://github.com/ibrahimhajjaj/helpdeck

## Exports

| Entry | What it gives you |
| --- | --- |
| `helpdeck` | Types, `ingest`, index building, retrieval, chunkers, sources |
| `helpdeck/server` | `createChatHandler`, a `Request` to `Response` function |
| `helpdeck/tool` | `knowledgeTool` for AI SDK and eve agents, `createKnowledgeSearch` |
| `helpdeck/ingest` | `ingest` and `writeIndex`, for build scripts |

## CLI

```
helpdeck ingest --url <site>     Learn a website
helpdeck ingest --path <dir>     Learn a folder of markdown
helpdeck ask "<question>"        Ask the index from the terminal
helpdeck stats                   Show what is in the index
```

MIT
