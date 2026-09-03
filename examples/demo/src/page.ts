/**
 * The page somebody lands on.
 *
 * Two columns, because the question a stranger arrives with is "is this any
 * good?" and the fastest honest answer is to show them one. The left half is
 * the pitch and the suggested questions; the right half is a real answer this
 * agent gave, citations and all, sitting there before anybody clicks anything.
 *
 * The chat panel starts closed and invites itself after a few seconds. Open on
 * arrival would cover the one thing on the page that makes the case.
 */
import { WIDGET_TAG } from './widget.js'

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>recourse, answering from its own documentation</title>
<style>
  :root {
    color-scheme: light dark;
    --bg:#ffffff; --panel:#ffffff; --ink:#111827; --dim:#6b7280; --line:#e5e7eb;
    --bubble:#eef0f3; --field:#f7f8f9; --accent:#2563eb; --accent-ink:#ffffff;
    --link:#2563eb; --code:rgba(127,127,127,.16);
    --mark-filter:none;
    --texture:url('/assets/texture-light.png');
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0b0f17; --panel:#111827; --ink:#f3f4f6; --dim:#a8b1bf; --line:#2b323d;
      --bubble:#1f2937; --field:#0f1520; --link:#93b4ff; --code:rgba(255,255,255,.12);
      /* The mark is drawn in near black; inverted it reads on the dark ground
         without shipping a second file. */
      --mark-filter:invert(1) brightness(1.35);
      --texture:url('/assets/texture-dark.png');
    }
  }

  *, *::before, *::after { box-sizing:border-box }
  html, body { margin:0; padding:0 }
  body {
    background:var(--bg); color:var(--ink); font-size:16px; line-height:1.6;
    font-family:ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  a { color:var(--link) }

  .split { display:grid; grid-template-columns:1fr 1fr; min-height:100vh }

  .pitch {
    display:flex; flex-direction:column; padding:80px 56px 56px 72px;
    background-image:var(--texture);
    background-size:120% auto; background-position:left bottom; background-repeat:no-repeat;
  }

  .brand { display:flex; align-items:center; gap:14px; margin-bottom:44px }
  .brand img { width:46px; height:auto; flex:none; display:block; filter:var(--mark-filter) }
  .brand span { font-size:15px; font-weight:620; letter-spacing:-0.01em }

  h1 { margin:0 0 10px; font-size:46px; line-height:1.06; letter-spacing:-0.03em; font-weight:640 }
  .sub { margin:0 0 24px; font-size:20px; line-height:1.45; color:var(--dim); max-width:28ch }
  .lede { margin:0 0 40px; font-size:16px; line-height:1.65; max-width:44ch; text-wrap:pretty }

  .label {
    font-size:11px; font-weight:600; line-height:1; letter-spacing:.09em;
    text-transform:uppercase; color:var(--dim); margin-bottom:16px;
  }

  .try { display:flex; flex-direction:column; gap:9px; align-items:flex-start; margin-bottom:auto }
  .try button {
    font:inherit; font-size:15px; line-height:1.35; color:var(--ink);
    background:transparent; border:1px solid var(--line); border-radius:999px;
    padding:11px 18px; cursor:pointer; text-align:left; min-height:44px; white-space:nowrap;
    transition:border-color .12s ease, color .12s ease;
  }
  .try button:hover { border-color:var(--accent); color:var(--link) }
  .try button:focus-visible { outline:2px solid var(--accent); outline-offset:2px }

  .note { margin:44px 0 0; font-size:13.5px; line-height:1.6; color:var(--dim); max-width:52ch; text-wrap:pretty }

  .proof {
    display:flex; flex-direction:column; justify-content:center; gap:16px;
    padding:80px 72px 56px 56px; background:var(--field); border-left:1px solid var(--line);
  }
  .proof .label { font-family:ui-monospace, Menlo, monospace; letter-spacing:.1em; margin-bottom:4px }
  .asked {
    align-self:flex-end; max-width:80%; background:var(--accent); color:var(--accent-ink);
    padding:11px 14px; border-radius:14px; border-bottom-right-radius:4px; font-size:15px; line-height:1.5;
  }
  .answered {
    max-width:88%; background:var(--bubble); padding:13px 15px;
    border-radius:14px; border-bottom-left-radius:4px; font-size:15px; line-height:1.55; text-wrap:pretty;
  }
  .answered code { font:13px ui-monospace, Menlo, monospace; background:var(--code); padding:1px 5px; border-radius:5px }
  .cites { display:flex; flex-wrap:wrap; gap:6px }
  .cites span {
    font-size:11.5px; color:var(--dim); border:1px solid var(--line);
    background:var(--panel); border-radius:999px; padding:3px 9px;
  }

  /* One column below 900px. The proof panel goes rather than stacking: on a
     phone the chat panel covers most of the screen anyway, so a second
     transcript underneath is a scroll nobody makes. */
  @media (max-width: 900px) {
    .split { grid-template-columns:1fr }
    .pitch { padding:32px 20px 140px; background-image:none }
    .proof { display:none }
    h1 { font-size:34px }
    .sub { font-size:18px }
    .try button { border-radius:14px; white-space:normal }
  }
</style>
</head>
<body>
<div class="split">
  <div class="pitch">
    <div class="brand">
      <img src="/assets/mark.png" alt="" width="46" height="29">
      <span>recourse</span>
    </div>

    <h1>recourse</h1>
    <p class="sub">A customer support agent that learns your own content.</p>
    <p class="lede">
      This one has read its own documentation. Ask it something and it answers
      from the pages in <a href="https://github.com/ibrahimhajjaj/recourse">the repository</a>,
      citing which one it used.
    </p>

    <div class="label">Try one</div>
    <div class="try">
      <button data-ask="How do I fix a wrong answer without deploying?">How do I fix a wrong answer without deploying?</button>
      <button data-ask="Does it work without an API key?">Does it work without an API key?</button>
      <button data-ask="How do I put it on WordPress?">How do I put it on WordPress?</button>
      <button data-ask="Can it answer a phone call?">Can it answer a phone call?</button>
      <button data-ask="How do I hand a conversation to a person?">How do I hand a conversation to a person?</button>
    </div>

    <p class="note">
      Retrieval here is keyword only, with no embeddings, because that is what you
      get before signing up for anything. Answers are limited and rate limited: it
      is a demo on somebody's free tier, not a service.
    </p>
  </div>

  <div class="proof">
    <div class="label">An answer it gave earlier</div>
    <div class="asked">Does it work without an API key?</div>
    <div class="answered">
      Yes. Retrieval runs locally with no credential at all. Without a model
      configured, <code>ask</code> shows you the passages it found and says what
      is missing, rather than making a request that cannot succeed.
    </div>
    <div class="cites">
      <span>docs/models.md</span>
      <span>README.md &middot; It runs before you configure anything</span>
    </div>
  </div>
</div>

<script
  src="/recourse.js?v=${WIDGET_TAG}"
  data-endpoint="/api/chat"
  data-title="recourse"
  data-subtitle="Answering from its own documentation"
  data-greeting="Ask about anything in the documentation. Every answer says which page it came from."
  data-suggestions="How do I fix a wrong answer without deploying?|Does it work without an API key?|How do I put it on WordPress?"
  data-invite="Ask it anything from the docs."
  data-invite-delay="2600"
  data-footnote="You are chatting with an AI assistant."
  data-dictation="true"
  defer></script>
<script>
  // The buttons put the question into the widget rather than navigating, so the
  // first thing a visitor sees is an answer arriving in the place they will
  // keep asking from. Opening is the caller's job: ask() on its own would run
  // the question behind a closed panel.
  document.addEventListener('click', (event) => {
    const asked = event.target.closest('[data-ask]')
    if (!asked) return

    const widget = window.recourse
    if (!widget || typeof widget.ask !== 'function') return

    if (typeof widget.open === 'function') widget.open()
    widget.ask(asked.dataset.ask)
  })
</script>
</body>
</html>`
