/**
 * The page somebody lands on.
 *
 * Deliberately small. A demo that needs explaining before it can be tried is a
 * demo nobody tries: the widget is open on arrival and the suggested questions
 * are real ones with real answers in the documentation, so the first click
 * produces something worth reading rather than "Hello! How can I help you?".
 */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>recourse, answering from its own documentation</title>
<style>
  :root { color-scheme: light dark; --ink:#111; --dim:#666; --line:#e5e5e5; --bg:#fff; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#eee; --dim:#999; --line:#2a2a2a; --bg:#111; }
  }
  * { box-sizing: border-box }
  body {
    margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
    display:flex; justify-content:center; padding:48px 20px 120px;
  }
  main { max-width:640px; width:100% }
  h1 { font-size:28px; margin:0 0 4px; letter-spacing:-0.02em }
  p.sub { color:var(--dim); margin:0 0 28px }
  p { margin:0 0 16px }
  .try { border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin:28px 0 }
  .try h2 { font-size:14px; text-transform:uppercase; letter-spacing:0.06em; color:var(--dim); margin:0 0 12px; font-weight:600 }
  .try button {
    display:block; width:100%; text-align:left; font:inherit; font-size:15px; color:var(--ink);
    background:none; border:0; border-radius:6px; padding:8px 10px; cursor:pointer;
  }
  .try button:hover { background:var(--line) }
  .note { color:var(--dim); font-size:14px }
  a { color:inherit }
</style>
</head>
<body>
<main>
  <h1>recourse</h1>
  <p class="sub">A customer support agent that learns your own content.</p>

  <p>
    This one has read its own documentation. Ask it something and it answers from
    the pages in <a href="https://github.com/ibrahimhajjaj/recourse">the repository</a>,
    citing which one it used.
  </p>

  <div class="try">
    <h2>Try one</h2>
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
</main>

<script src="/recourse.js" data-endpoint="/api/chat" data-title="recourse" data-open="true" defer></script>
<script>
  // The buttons put the question into the widget rather than navigating, so the
  // first thing a visitor sees is an answer arriving in the place they will
  // keep asking from.
  document.addEventListener('click', (event) => {
    const asked = event.target.closest('[data-ask]')
    if (!asked) return

    const widget = window.recourse
    if (widget && typeof widget.ask === 'function') widget.ask(asked.dataset.ask)
  })
</script>
</body>
</html>`
