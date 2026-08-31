export default function Home() {
  return (
    <div className="wrap">
      <header>
        <div className="brand">
          <span className="dot" aria-hidden />
          Lumen Coffee Roasters
        </div>
        <nav>
          <span>Shop</span>
          <span>Subscriptions</span>
          <span>Wholesale</span>
          <span>Help</span>
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">Demo shop</p>
        <h1>Coffee roasted the morning it ships.</h1>
        <p className="lede">
          This shop is not real. Its help pages are, and the support agent in the
          bottom corner was trained on them and nothing else. Ask it something.
        </p>
        <a className="cta" href="#help">
          Try the agent
        </a>
      </section>

      <div className="grid" id="help">
        <article className="card">
          <h3>Ask about delivery</h3>
          <p>&ldquo;How long does shipping to the US take, and what does it cost?&rdquo;</p>
        </article>
        <article className="card">
          <h3>Ask about refunds</h3>
          <p>&ldquo;I ordered 6kg for my cafe last week, can I send it back?&rdquo;</p>
        </article>
        <article className="card">
          <h3>Ask something it cannot know</h3>
          <p>&ldquo;Do you sell tea?&rdquo; It should decline rather than invent an answer.</p>
        </article>
      </div>

      <p className="note">
        The agent answers only from <code>examples/nextjs/content</code>, retrieved at request
        time and cited under each reply. Point it at a real site instead with{' '}
        <code>recourse ingest --url https://your-site.com</code>.
      </p>
    </div>
  )
}
