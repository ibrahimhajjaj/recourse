/**
 * A single self-contained admin page.
 *
 * Everything it shows is already available over the API, so this is not where
 * the functionality lives. It exists because a support lead should be able to
 * read yesterday's conversations and the list of questions nobody could answer
 * without first building a dashboard application. One file, no build step, no
 * framework, no dependency to keep current.
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>helpdeck</title>
<style>
  :root {
    --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --bg:#ffffff; --soft:#f9fafb; --accent:#2563eb;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#f3f4f6; --muted:#9ca3af; --line:#1f2937; --bg:#0b0f17; --soft:#111827; }
  }
  * { box-sizing:border-box }
  body {
    margin:0; background:var(--bg); color:var(--ink); line-height:1.5;
    font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  header { border-bottom:1px solid var(--line); padding:14px 20px; display:flex; gap:16px; align-items:center }
  header h1 { font-size:15px; margin:0; font-weight:650 }
  nav { display:flex; gap:4px; margin-left:auto; flex-wrap:wrap }
  nav button {
    font:inherit; border:1px solid transparent; background:none; color:var(--muted);
    padding:5px 11px; border-radius:8px; cursor:pointer;
  }
  nav button:hover { color:var(--ink) }
  nav button[aria-current="true"] { background:var(--soft); border-color:var(--line); color:var(--ink) }
  main { padding:20px; max-width:1100px; margin:0 auto }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:20px }
  .stat { border:1px solid var(--line); border-radius:11px; padding:12px 14px }
  .stat b { display:block; font-size:22px; font-weight:650; letter-spacing:-0.02em }
  .stat span { color:var(--muted); font-size:12.5px }
  table { width:100%; border-collapse:collapse; font-size:13.5px }
  th { text-align:left; color:var(--muted); font-weight:560; padding:8px 10px; border-bottom:1px solid var(--line) }
  td { padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top }
  tr:hover td { background:var(--soft) }
  .pill { display:inline-block; font-size:11.5px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--muted) }
  .muted { color:var(--muted) }
  .empty { color:var(--muted); padding:32px 0; text-align:center }
  .transcript { border:1px solid var(--line); border-radius:11px; padding:14px; margin-top:12px; background:var(--soft) }
  .turn { margin-bottom:10px }
  .turn b { font-size:12px; color:var(--muted); font-weight:560 }
  .turn p { margin:2px 0 0; white-space:pre-wrap }
  button.link { font:inherit; border:0; background:none; color:var(--accent); cursor:pointer; padding:0; text-align:left }
  .error { border:1px solid #fecaca; background:#fef2f2; color:#b91c1c; padding:10px 14px; border-radius:10px }
</style>
</head>
<body>
<header>
  <h1>helpdeck</h1>
  <nav>
    <button data-view="activity" aria-current="true">Activity</button>
    <button data-view="gaps">Answer gaps</button>
    <button data-view="tickets">Tickets</button>
    <button data-view="leads">Leads</button>
    <button data-view="sources">Sources</button>
  </nav>
</header>
<main>
  <div class="stats" id="stats"></div>
  <div id="view"><p class="empty">Loading…</p></div>
</main>
<script type="module">
// The page is served from the API's own base path, so relative URLs just work.
const base = location.pathname.replace(/\\/admin\\/?$/, '')
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props)
  for (const child of [].concat(children)) node.append(child)
  return node
}

async function api(path) {
  const response = await fetch(base + path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || response.statusText)
  return (await response.json()).data
}

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '')
const table = (headers, rows) =>
  rows.length === 0
    ? el('p', { className: 'empty', textContent: 'Nothing here yet.' })
    : el('table', {}, [
        el('thead', {}, el('tr', {}, headers.map((h) => el('th', { textContent: h })))),
        el('tbody', {}, rows),
      ])

const views = {
  async activity() {
    const conversations = await api('/conversations?limit=50')
    return table(
      ['When', 'Channel', 'Contact', ''],
      conversations.map((conversation) =>
        el('tr', {}, [
          el('td', { textContent: when(conversation.updatedAt) }),
          el('td', {}, el('span', { className: 'pill', textContent: conversation.channel })),
          el('td', { className: 'muted', textContent: conversation.contact?.email || conversation.contact?.name || '' }),
          el('td', {}, el('button', {
            className: 'link',
            textContent: 'Read',
            onclick: async (event) => {
              const row = event.target.closest('tr')
              if (row.nextElementSibling?.dataset.transcript) return row.nextElementSibling.remove()
              const full = await api('/conversations/' + encodeURIComponent(conversation.id))
              const box = el('div', { className: 'transcript' },
                full.messages.map((message) =>
                  el('div', { className: 'turn' }, [
                    el('b', { textContent: message.role === 'user' ? 'Customer' : 'Agent' }),
                    el('p', { textContent: message.content }),
                  ]),
                ),
              )
              const holder = el('tr', {}, el('td', { colSpan: 4 }, box))
              holder.dataset.transcript = '1'
              row.after(holder)
            },
          })),
        ]),
      ),
    )
  },

  async gaps() {
    const stats = await api('/stats')
    return table(
      ['Question nobody could answer', 'Times asked'],
      (stats.topGaps || []).map((gap) =>
        el('tr', {}, [el('td', { textContent: gap.question }), el('td', { textContent: String(gap.count) })]),
      ),
    )
  },

  async tickets() {
    const tickets = await api('/helpdesk/tickets?limit=50')
    return table(
      ['#', 'Subject', 'Status', 'Team', 'Assignee', 'Updated'],
      tickets.map((ticket) =>
        el('tr', {}, [
          el('td', { textContent: '#' + ticket.ticketNumber }),
          el('td', { textContent: ticket.subject }),
          el('td', {}, el('span', { className: 'pill', textContent: ticket.statusCategory })),
          el('td', { className: 'muted', textContent: ticket.teamId || '' }),
          el('td', { className: 'muted', textContent: ticket.assigneeId || 'unassigned' }),
          el('td', { className: 'muted', textContent: when(ticket.updatedAt) }),
        ]),
      ),
    )
  },

  async leads() {
    const leads = await api('/leads?limit=50')
    return table(
      ['When', 'Details'],
      leads.map((lead) =>
        el('tr', {}, [
          el('td', { textContent: when(lead.createdAt) }),
          el('td', { textContent: Object.entries(lead.values).map(([k, v]) => k + ': ' + v).join('  ·  ') }),
        ]),
      ),
    )
  },

  async sources() {
    const sources = await api('/sources')
    return table(
      ['Name', 'Type', 'Chunks', 'Updated'],
      sources.map((source) =>
        el('tr', {}, [
          el('td', { textContent: source.name }),
          el('td', {}, el('span', { className: 'pill', textContent: source.type })),
          el('td', { textContent: String(source.chunks ?? 0) }),
          el('td', { className: 'muted', textContent: when(source.updatedAt) }),
        ]),
      ),
    )
  },
}

async function renderStats() {
  const stats = await api('/stats')
  const cards = [
    ['Conversations', stats.conversations],
    ['Messages', stats.messages],
    ['Unanswered', stats.unanswered],
    ['Leads', stats.leads],
    ['Thumbs up', stats.thumbsUp],
    ['Thumbs down', stats.thumbsDown],
  ]
  document.getElementById('stats').replaceChildren(
    ...cards.map(([label, value]) =>
      el('div', { className: 'stat' }, [el('b', { textContent: String(value ?? 0) }), el('span', { textContent: label })]),
    ),
  )
}

async function show(name) {
  const host = document.getElementById('view')
  host.replaceChildren(el('p', { className: 'empty', textContent: 'Loading…' }))

  for (const button of document.querySelectorAll('nav button')) {
    button.setAttribute('aria-current', String(button.dataset.view === name))
  }

  try {
    host.replaceChildren(await views[name]())
  } catch (error) {
    // A disabled feature answers 501, which is information rather than a fault.
    host.replaceChildren(el('div', { className: 'error', textContent: error.message }))
  }
}

for (const button of document.querySelectorAll('nav button')) {
  button.addEventListener('click', () => show(button.dataset.view))
}

renderStats().catch(() => {})
show('activity')
</script>
</body>
</html>`
