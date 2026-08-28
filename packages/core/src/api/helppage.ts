import type { KnowledgeIndex } from '../types.js'
import { createRetriever } from '../retrieve/retriever.js'
import type { Embedder } from '../types.js'

export interface HelpPageOptions {
  index: KnowledgeIndex
  /** Shown in the header and the page title. */
  business?: string
  /** Where the chat widget is mounted, so the page can offer it. */
  chatEndpoint?: string
  /** Enables the vector half of search, if the index has one. */
  embedder?: Embedder
  /** Results per search. */
  topK?: number
  basePath?: string
}

/**
 * A public help centre served from the same index the agent answers from.
 *
 * Two reasons this is worth having. Some people would rather read than ask, and
 * a chat widget gives them nowhere to go. And a static help page is indexable,
 * so the content that answers your customers can also be found by people who
 * have not become customers yet.
 *
 * Search happens on the server, against the same retriever, so the page needs
 * no client-side index and stays fast on a phone.
 */
export function createHelpPage(options: HelpPageOptions) {
  const retriever = createRetriever({
    index: options.index,
    embedder: options.embedder,
    topK: options.topK ?? 8,
  })

  const business = options.business ?? 'Help centre'
  const base = (options.basePath ?? '').replace(/\/+$/, '')

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405 })

    const url = new URL(request.url)
    const query = (url.searchParams.get('q') ?? '').slice(0, 200)

    const matches = query.trim() ? await retriever.retrieve(query) : []

    // Grouped by page, because five chunks of one article is one result to a
    // reader, not five.
    const grouped = new Map<string, { title: string; url?: string; passages: string[] }>()
    for (const match of matches) {
      const key = match.chunk.url ?? match.chunk.docId
      const entry = grouped.get(key) ?? { title: match.chunk.title, url: match.chunk.url, passages: [] }
      entry.passages.push(match.chunk.text)
      grouped.set(key, entry)
    }

    const results = [...grouped.values()]

    return new Response(page({ business, query, results, base, chatEndpoint: options.chatEndpoint }), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Public and cacheable when there is no query; a search is per-visitor.
        'Cache-Control': query ? 'private, no-store' : 'public, max-age=300',
      },
    })
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function page(view: {
  business: string
  query: string
  results: Array<{ title: string; url?: string; passages: string[] }>
  base: string
  chatEndpoint?: string
}): string {
  const heading = escapeHtml(view.business)
  const query = escapeHtml(view.query)

  const body =
    view.query.trim() === ''
      ? '<p class="hint">Search the help pages, or ask the assistant.</p>'
      : view.results.length === 0
        ? `<p class="hint">Nothing matched “${query}”. Try different words, or ask the assistant.</p>`
        : view.results
            .map((result) => {
              const title = escapeHtml(result.title)
              const linked = result.url
                ? `<a href="${escapeHtml(result.url)}">${title}</a>`
                : title
              const passages = result.passages
                .slice(0, 2)
                .map((passage) => `<p>${escapeHtml(passage.slice(0, 420))}${passage.length > 420 ? '…' : ''}</p>`)
                .join('')
              return `<article><h2>${linked}</h2>${passages}</article>`
            })
            .join('')

  const widget = view.chatEndpoint
    ? `<script src="${escapeHtml(view.base)}/helpdeck.js" data-endpoint="${escapeHtml(view.chatEndpoint)}"></script>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
<meta name="description" content="Answers to common questions about ${heading}.">
<style>
  :root { --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --bg:#fff; --accent:#2563eb; color-scheme:light dark }
  @media (prefers-color-scheme:dark){ :root{ --ink:#f3f4f6; --muted:#9ca3af; --line:#1f2937; --bg:#0b0f17 } }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);line-height:1.6;
    font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:720px;margin:0 auto;padding:48px 24px 96px}
  h1{font-size:clamp(26px,4vw,34px);letter-spacing:-0.02em;margin:0 0 22px}
  form{display:flex;gap:8px;margin-bottom:32px}
  input{flex:1;font:inherit;padding:12px 15px;border:1px solid var(--line);border-radius:11px;
    background:var(--bg);color:var(--ink)}
  input:focus{outline:2px solid var(--accent);outline-offset:-1px}
  button{font:inherit;font-weight:560;padding:12px 20px;border:0;border-radius:11px;
    background:var(--accent);color:#fff;cursor:pointer}
  article{border-top:1px solid var(--line);padding:22px 0}
  article h2{font-size:17px;margin:0 0 8px;font-weight:620}
  article a{color:inherit}
  article p{margin:0 0 8px;color:var(--muted);font-size:15px}
  .hint{color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">
  <h1>${heading}</h1>
  <form method="get" action="${escapeHtml(view.base)}/">
    <input type="search" name="q" value="${query}" placeholder="Search for an answer" aria-label="Search the help pages" autofocus>
    <button type="submit">Search</button>
  </form>
  ${body}
</div>
${widget}
</body>
</html>`
}
