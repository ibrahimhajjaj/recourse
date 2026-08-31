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
  .editor { display:grid; grid-template-columns:minmax(260px,1fr) minmax(300px,1.2fr); gap:20px; align-items:start }
  @media (max-width:820px) { .editor { grid-template-columns:1fr } }
  .field { display:flex; flex-direction:column; gap:4px; margin-bottom:12px }
  .field label { font-size:12px; color:var(--dim) }
  .field input[type=text], .field select, .field textarea {
    font:inherit; font-size:13px; padding:6px 8px; border:1px solid var(--line);
    border-radius:6px; background:var(--bg); color:var(--ink)
  }
  .field textarea { resize:vertical; min-height:56px }
  .switches { display:flex; flex-wrap:wrap; gap:10px 16px; margin-bottom:12px }
  .switches label { font-size:13px; display:flex; gap:6px; align-items:center }
  .preview { position:relative; min-height:440px; border:1px solid var(--line); border-radius:10px;
    background:var(--soft); overflow:hidden }
  .preview .note { position:absolute; inset:0; display:grid; place-items:center; padding:20px;
    text-align:center; font-size:13px; color:var(--dim) }
  .snippet { margin-top:16px }
  .snippet pre { background:var(--soft); border:1px solid var(--line); border-radius:8px;
    padding:12px; overflow:auto; font-size:12.5px; margin:6px 0 0 }
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
    <button data-view="widget">Widget</button>
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
  /**
   * The widget, configured by hand and copied out.
   *
   * Nothing is saved. The snippet is the configuration: it goes on your site,
   * so there is no state here that could drift from what visitors actually
   * see, and no migration when a field is added. That is the difference
   * between configuring a hosted product and configuring your own.
   */
  async widget() {
    const settings = {
      endpoint: base + '/../chat',
      script: '/helpdeck.js',
      title: '',
      subtitle: '',
      greeting: '',
      accent: '#2563eb',
      position: 'bottom-right',
      theme: 'auto',
      suggestions: '',
      invite: '',
      feedback: true,
      copy: true,
      attachments: false,
      dictation: false,
      open: false,
      persist: true,
    }

    const preview = el('div', { className: 'preview' })
    const code = el('pre')
    let mounted = null

    const attributes = () => {
      const out = [['data-endpoint', settings.endpoint]]
      const add = (name, value, unless) => { if (value !== unless && value !== '') out.push([name, String(value)]) }

      add('data-title', settings.title)
      add('data-subtitle', settings.subtitle)
      add('data-greeting', settings.greeting)
      add('data-accent', settings.accent, '#2563eb')
      add('data-position', settings.position, 'bottom-right')
      add('data-theme', settings.theme, 'auto')
      add('data-suggestions', settings.suggestions.split('\\n').map((one) => one.trim()).filter(Boolean).join('|'))
      add('data-invite', settings.invite)
      if (!settings.feedback) out.push(['data-feedback', 'false'])
      if (!settings.copy) out.push(['data-copy', 'false'])
      if (settings.attachments) out.push(['data-attachments', 'true'])
      if (settings.dictation) out.push(['data-dictation', 'true'])
      if (settings.open) out.push(['data-open', 'true'])
      if (!settings.persist) out.push(['data-persist', 'false'])

      return out
    }

    const snippet = () =>
      '<script\\n  src="' + settings.script + '"\\n' +
      attributes().map(([name, value]) => '  ' + name + '="' + String(value).replace(/"/g, '&quot;') + '"').join('\\n') +
      '\\n  defer\\n></' + 'script>'

    // The real widget, not a drawing of it. A preview built from a copy of the
    // widget's own stylesheet is a second implementation that goes out of date
    // silently, and the first thing it would get wrong is the thing being
    // previewed.
    const render = async () => {
      code.textContent = snippet()

      try {
        const module = await import(new URL(settings.script, location.href).href)
        if (!module.createWidget) throw new Error('that script does not export createWidget')

        mounted?.destroy?.()
        preview.replaceChildren()
        mounted = module.createWidget({
          endpoint: settings.endpoint,
          target: preview,
          open: true,
          persist: false,
          title: settings.title || undefined,
          subtitle: settings.subtitle || undefined,
          greeting: settings.greeting || undefined,
          accent: settings.accent,
          theme: settings.theme,
          feedback: settings.feedback,
          copy: settings.copy,
          attachments: settings.attachments,
          dictation: settings.dictation,
          suggestions: settings.suggestions.split('\\n').map((one) => one.trim()).filter(Boolean),
        })
      } catch (error) {
        mounted = null
        preview.replaceChildren(el('div', { className: 'note' },
          el('div', {}, [
            el('p', { textContent: 'No preview: ' + error.message }),
            el('p', { className: 'muted', textContent:
              'Point "Widget script" at a build the browser can reach. The snippet below is correct either way.' }),
          ]),
        ))
      }
    }

    const text = (key, label, placeholder = '') =>
      el('div', { className: 'field' }, [
        el('label', { textContent: label, htmlFor: 'w-' + key }),
        el('input', {
          id: 'w-' + key, type: 'text', value: settings[key], placeholder,
          oninput: (event) => { settings[key] = event.target.value; render() },
        }),
      ])

    const choice = (key, label, values) =>
      el('div', { className: 'field' }, [
        el('label', { textContent: label, htmlFor: 'w-' + key }),
        el('select', {
          id: 'w-' + key,
          onchange: (event) => { settings[key] = event.target.value; render() },
        }, values.map((value) => el('option', { value, textContent: value, selected: settings[key] === value }))),
      ])

    const toggle = (key, label) =>
      el('label', {}, [
        el('input', {
          type: 'checkbox', checked: settings[key],
          onchange: (event) => { settings[key] = event.target.checked; render() },
        }),
        el('span', { textContent: label }),
      ])

    const form = el('div', {}, [
      text('endpoint', 'Chat endpoint'),
      text('script', 'Widget script'),
      text('title', 'Title', 'Ask us anything'),
      text('subtitle', 'Subtitle'),
      text('greeting', 'Opening line'),
      el('div', { className: 'field' }, [
        el('label', { textContent: 'Suggestions, one per line', htmlFor: 'w-suggestions' }),
        el('textarea', {
          id: 'w-suggestions', value: settings.suggestions,
          oninput: (event) => { settings.suggestions = event.target.value; render() },
        }),
      ]),
      text('invite', 'Invite bubble'),
      text('accent', 'Accent colour', '#2563eb'),
      choice('position', 'Position', ['bottom-right', 'bottom-left']),
      choice('theme', 'Theme', ['auto', 'light', 'dark']),
      el('div', { className: 'switches' }, [
        toggle('feedback', 'Thumbs'),
        toggle('copy', 'Copy button'),
        toggle('attachments', 'Attachments'),
        toggle('dictation', 'Microphone'),
        toggle('open', 'Starts open'),
        toggle('persist', 'Remembers'),
      ]),
    ])

    const copyButton = el('button', {
      className: 'link',
      textContent: 'Copy',
      onclick: async () => {
        await navigator.clipboard.writeText(snippet())
        copyButton.textContent = 'Copied'
        setTimeout(() => { copyButton.textContent = 'Copy' }, 1200)
      },
    })

    render()

    return el('div', {}, [
      el('div', { className: 'editor' }, [form, preview]),
      el('div', { className: 'snippet' }, [
        el('div', { style: 'display:flex;align-items:center;gap:10px' }, [
          el('b', { textContent: 'Paste this into your site' }),
          copyButton,
        ]),
        code,
        el('p', { className: 'muted', style: 'font-size:12px',
          textContent: 'Nothing here is saved. The snippet is the configuration.' }),
      ]),
    ])
  },
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
