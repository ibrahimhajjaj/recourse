/**
 * Starting a WhatsApp conversation, rather than answering one.
 *
 * WhatsApp will not carry a message you wrote to somebody who has not written
 * to you in the last 24 hours. Outside that window the only thing that goes
 * through is a template Meta approved in advance, with the variable parts
 * filled in. Sending plain text there fails with a code most people read as a
 * broken token, and the fix is not a bigger retry.
 *
 * So this is the sender an outbound campaign on WhatsApp needs. The wording
 * lives in Meta's dashboard rather than in your code, which is the trade the
 * platform imposes: what you supply here is which template, in which language,
 * and the values that go in its holes.
 */

export interface WhatsAppTemplateOptions {
  phoneNumberId: string
  accessToken: string
  /** Graph API version. Pinned so a rollover cannot change behaviour silently. */
  apiVersion?: string
}

export interface TemplateMessage {
  /** The recipient, in international format without a leading `+`. */
  to: string
  /** The template's name as approved, exactly. */
  template: string
  /** Its language code, such as `en_GB`. Must match the approved one. */
  language: string
  /**
   * The values for the template's `{{1}}`, `{{2}}` and so on, in order.
   *
   * Positional because that is what the API takes. Meta rejects the message if
   * the count does not match the approved body, which is a good failure: the
   * alternative is a customer reading "Hi {{1}}".
   */
  variables?: string[]
  /** Values for a header that has one. Usually a single string. */
  headerVariables?: string[]
}

/**
 * Sends one approved template.
 *
 * Returns the message id, which is what a delivery webhook later reports
 * against, so a campaign that keeps it can tell delivered from merely sent.
 */
export async function sendWhatsAppTemplate(
  options: WhatsAppTemplateOptions,
  message: TemplateMessage,
): Promise<{ id: string }> {
  const version = options.apiVersion ?? 'v21.0'

  const components: Array<Record<string, unknown>> = []
  if (message.headerVariables?.length) {
    components.push({ type: 'header', parameters: message.headerVariables.map(asText) })
  }
  if (message.variables?.length) {
    components.push({ type: 'body', parameters: message.variables.map(asText) })
  }

  const response = await fetch(`https://graph.facebook.com/${version}/${options.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'template',
      template: {
        name: message.template,
        language: { code: message.language },
        ...(components.length > 0 ? { components } : {}),
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`WhatsApp template send failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
  }

  const body = (await response.json()) as { messages?: Array<{ id?: string }> }
  return { id: body.messages?.[0]?.id ?? '' }
}

export interface ApprovedTemplate {
  name: string
  language: string
  status: string
  category: string
  /** How many `{{n}}` the body has, so a campaign can check before it sends. */
  variables: number
}

/**
 * The templates Meta has approved on this account.
 *
 * Worth reading before a campaign rather than after: a template that is still
 * `PENDING`, or was rejected last week, fails per recipient at send time, and
 * finding that out on the four thousandth one is not a good way to find out.
 *
 * Takes the business account id, not the phone number id. They are different
 * numbers in the same dashboard and it is the single easiest thing to get
 * wrong here.
 */
export async function whatsAppTemplates(options: {
  businessAccountId: string
  accessToken: string
  apiVersion?: string
}): Promise<ApprovedTemplate[]> {
  const version = options.apiVersion ?? 'v21.0'
  const headers = { Authorization: `Bearer ${options.accessToken}` }
  const found: ApprovedTemplate[] = []

  // Followed to the end rather than reading the first hundred. An account with
  // more than that would otherwise report a template as missing when it is
  // simply on page two, and the caller's whole reason for asking is to find out
  // whether the one it is about to send four thousand times exists.
  let next: string | null =
    `https://graph.facebook.com/${version}/${encodeURIComponent(options.businessAccountId)}/message_templates?limit=100`

  // A ceiling on the walk, so a paging cursor that never terminates cannot
  // turn a pre-flight check into an infinite loop.
  for (let page = 0; next && page < 50; page++) {
    const response: Response = await fetch(next, { headers })
    if (!response.ok) {
      throw new Error(`could not read WhatsApp templates: ${response.status} ${(await response.text()).slice(0, 300)}`)
    }

    const body = (await response.json()) as {
      data?: Array<{
        name?: string
        language?: string
        status?: string
        category?: string
        components?: Array<{ type?: string; text?: string }>
      }>
      paging?: { next?: string }
    }

    for (const template of body.data ?? []) {
      found.push({
        name: template.name ?? '',
        language: template.language ?? '',
        status: template.status ?? '',
        category: template.category ?? '',
        variables: countHoles(template.components ?? []),
      })
    }

    next = body.paging?.next ?? null
  }

  return found
}

/** How many `{{n}}` the body carries. */
function countHoles(components: Array<{ type?: string; text?: string }>): number {
  const body = components.find((component) => component.type?.toUpperCase() === 'BODY')
  return new Set(body?.text?.match(/\{\{\s*\d+\s*\}\}/g) ?? []).size
}

function asText(value: string): { type: 'text'; text: string } {
  return { type: 'text', text: value }
}
