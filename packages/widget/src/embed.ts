import { createWidget } from './widget.js'
import type { WidgetOptions } from './types.js'

/**
 * The script-tag entry point. Reads its own <script> element's data attributes
 * so dropping the widget onto a site is one line of HTML with no JavaScript to
 * write. `window.helpdeck` is left behind for anyone who wants to drive it.
 */
declare global {
  interface Window {
    helpdeck?: ReturnType<typeof createWidget>
    helpdeckConfig?: Partial<WidgetOptions>
  }
}

function readConfig(): WidgetOptions | null {
  const script = document.currentScript as HTMLScriptElement | null
  const data = script?.dataset ?? {}

  const endpoint = data.endpoint ?? window.helpdeckConfig?.endpoint
  if (!endpoint) {
    console.warn('[helpdeck] no data-endpoint on the script tag, widget not mounted')
    return null
  }

  const target = data.target ? (document.querySelector(data.target) as HTMLElement | null) : null

  return {
    endpoint,
    userId: data.userId,
    userHash: data.userHash,
    feedback: data.feedback !== 'false',
    title: data.title,
    subtitle: data.subtitle,
    greeting: data.greeting,
    accent: data.accent,
    suggestions: data.suggestions?.split('|').map((item) => item.trim()).filter(Boolean),
    position: data.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    theme: data.theme === 'dark' || data.theme === 'light' ? data.theme : 'auto',
    open: data.open === 'true',
    persist: data.persist !== 'false',
    ...window.helpdeckConfig,
    ...(target ? { target } : {}),
  }
}

const config = readConfig()

if (config) {
  const mount = () => {
    window.helpdeck = createWidget(config)
  }
  // `document.currentScript` is read above, so this must happen after the read.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
  else mount()
}
