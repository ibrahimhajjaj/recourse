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
          data-suggestions="How long does delivery take?|Can I get a refund?|How do I pause my subscription?|What grind for a French press?"
        />
      </body>
    </html>
  )
}
