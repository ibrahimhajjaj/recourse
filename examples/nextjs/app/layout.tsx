import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: 'Lumen Coffee Roasters',
  description: 'A demo shop with a helpdeck support agent trained on its own help pages.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}

        {/*
          This is the entire client integration. Any site that can host a script
          tag can host the agent: WordPress, Shopify, Webflow, a static export.
        */}
        <Script
          src="/helpdeck.js"
          strategy="afterInteractive"
          data-endpoint="/api/chat"
          data-title="Ask Nadia"
          data-subtitle="Lumen Coffee support"
          data-greeting="Hi, I'm Nadia. Ask me anything about orders, subscriptions or the coffee itself."
          data-accent="#a4551f"
          data-suggestions="How long does delivery take?|Can I get a refund?|How do I pause my subscription?|What's in my basket?"
          data-invite="Question about an order? Ask me."
          data-invite-delay="2000"
        />

        {/*
          The browser half of a client action. The basket lives in the page, so
          the agent asks for it rather than the server guessing.
        */}
        <Script id="helpdeck-actions" strategy="afterInteractive">
          {`
            (function register() {
              if (!window.helpdeck) return void setTimeout(register, 50)
              window.helpdeck.handle('read_basket', function () {
                return {
                  items: [
                    { name: 'Ethiopia Guji, 250g, whole bean', price: 11.5 },
                    { name: 'Decaf Colombia, 250g, ground for filter', price: 10.0 }
                  ],
                  total: 21.5,
                  currency: 'GBP'
                }
              })
            })()
          `}
        </Script>
      </body>
    </html>
  )
}
