import type { Store } from '../store/types.js'
import type { Channel } from '../store/types.js'
import { pool } from '../util/pool.js'

/**
 * Outbound campaigns: messages you start, rather than answer.
 *
 * The hard part is not sending. It is not sending to people who never agreed to
 * hear from you, not sending the same thing twice because a run was retried,
 * and not sending so fast that the provider blocks the number. All three are
 * handled here, because every one of them is a mistake you only make once.
 */

export interface CampaignRecipient {
  /** The address for the channel: a phone number, an email, a chat id. */
  to: string
  name?: string
  /** Substituted into the template as `{{key}}`. */
  variables?: Record<string, string>
  /**
   * Whether this person agreed to be contacted. A recipient without an explicit
   * true is skipped, because the default has to be "no".
   */
  consented?: boolean
}

export interface CampaignOptions {
  name: string
  channel: Channel
  /** `Hello {{name}}, your order {{order}} has shipped.` */
  template: string
  recipients: CampaignRecipient[]
  /** Sends one message. Throwing marks that recipient failed. */
  send: (to: string, message: string, recipient: CampaignRecipient) => Promise<void>
  /** Messages in flight at once. Kept low: providers rate limit hard. */
  concurrency?: number
  /** Pause between sends, per worker, in milliseconds. */
  throttleMs?: number
  /** Records the send, so a repeat run can skip anyone already contacted. */
  store?: Store
  /** Stops after this many failures, rather than burning the whole list. */
  abortAfterFailures?: number
  onProgress?: (progress: CampaignProgress) => void
}

export interface CampaignProgress {
  sent: number
  failed: number
  skipped: number
  total: number
}

export interface CampaignResult extends CampaignProgress {
  name: string
  startedAt: string
  finishedAt: string
  /** Why each skipped recipient was skipped, for the report. */
  skippedReasons: Record<string, number>
  failures: Array<{ to: string; error: string }>
  /** True when the run stopped early because too much was failing. */
  aborted: boolean
}

export function renderTemplate(template: string, recipient: CampaignRecipient): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    if (key === 'name') return recipient.name ?? ''
    return recipient.variables?.[key] ?? ''
  })
}

/** Everything wrong with a recipient, before a single message is sent. */
export function validateRecipients(recipients: CampaignRecipient[]): {
  ok: CampaignRecipient[]
  skipped: Array<{ to: string; reason: string }>
} {
  const ok: CampaignRecipient[] = []
  const skipped: Array<{ to: string; reason: string }> = []
  const seen = new Set<string>()

  for (const recipient of recipients) {
    const to = recipient.to?.trim()

    if (!to) {
      skipped.push({ to: '', reason: 'no address' })
      continue
    }
    if (recipient.consented !== true) {
      // The default is no. Anything else eventually sends marketing to someone
      // who never asked, which is both illegal and the fastest way to lose a
      // sending number.
      skipped.push({ to, reason: 'no consent' })
      continue
    }
    if (seen.has(to)) {
      skipped.push({ to, reason: 'duplicate' })
      continue
    }

    seen.add(to)
    ok.push({ ...recipient, to })
  }

  return { ok, skipped }
}

export async function runCampaign(options: CampaignOptions): Promise<CampaignResult> {
  const startedAt = new Date().toISOString()
  const { ok, skipped } = validateRecipients(options.recipients)

  const skippedReasons: Record<string, number> = {}
  for (const entry of skipped) skippedReasons[entry.reason] = (skippedReasons[entry.reason] ?? 0) + 1

  const failures: Array<{ to: string; error: string }> = []
  const abortAfter = options.abortAfterFailures ?? Math.max(10, Math.ceil(ok.length * 0.2))
  const throttleMs = options.throttleMs ?? 0

  let sent = 0
  let aborted = false

  await pool(ok, options.concurrency ?? 3, async (recipient) => {
    // Checked inside the worker so an abort stops the queue promptly rather
    // than after every worker has finished what it started.
    if (aborted) return

    const message = renderTemplate(options.template, recipient)

    try {
      await options.send(recipient.to, message, recipient)
      sent++

      await options.store?.appendMessage(
        `${options.channel}:${recipient.to}`,
        {
          id: `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content: message,
          createdAt: new Date().toISOString(),
        },
        { channel: options.channel, meta: { campaign: options.name } },
      )
    } catch (error) {
      failures.push({ to: recipient.to, error: error instanceof Error ? error.message : String(error) })
      if (failures.length >= abortAfter) aborted = true
    }

    options.onProgress?.({ sent, failed: failures.length, skipped: skipped.length, total: ok.length })
    if (throttleMs > 0) await new Promise((resolve) => setTimeout(resolve, throttleMs))
  })

  return {
    name: options.name,
    startedAt,
    finishedAt: new Date().toISOString(),
    sent,
    failed: failures.length,
    skipped: skipped.length,
    total: ok.length,
    skippedReasons,
    failures,
    aborted,
  }
}
