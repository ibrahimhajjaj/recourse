/**
 * Opening a WhatsApp conversation that the customer did not start.
 *
 * Meta only lets you send freely for 24 hours after a customer writes to you.
 * Outside that window every message has to be a template Meta approved in
 * advance, which is why a campaign runner that works perfectly for email and
 * SMS cannot say a word on WhatsApp without this file.
 *
 * The rule that catches everybody: **a template can only be sent from a number
 * on its own WhatsApp Business Account.** Templates belong to a WABA, phone
 * numbers belong to a WABA, and pairing one with a number from a different one
 * fails at send time with an error that does not say so. Every template listed
 * here carries the WABA it came from for that reason.
 *
 * Not verified against a live account. The shapes below are Meta's documented
 * ones and the tests drive them from fixtures; a real WABA would prove the
 * remaining half, and there is a note on the card saying so.
 */

import type { Store } from '../store/types.js'

export interface GraphCredentials {
  accessToken: string
  /** Defaults to a version this was written against. */
  apiVersion?: string
  /** Swappable for tests. */
  fetch?: typeof fetch
}

export interface TemplateVariable {
  /** Meta numbers its placeholders from 1: `{{1}}`, `{{2}}`. */
  position: number
  /** The example Meta holds for it, when the template carries one. */
  example?: string
}

export interface MessageTemplate {
  name: string
  /** BCP-47ish, as Meta writes it: `en_US`, `ar`, `pt_BR`. */
  language: string
  status: string
  category?: string
  /** The WABA it belongs to, and therefore the numbers that may send it. */
  wabaId: string
  /** Placeholders in the body, in order. */
  variables: TemplateVariable[]
}

const DEFAULT_VERSION = 'v21.0'

/**
 * Every approved template on one business account.
 *
 * Only approved ones come back. A template in review cannot be sent, and
 * offering it to somebody building a campaign is offering them a failure in a
 * few minutes' time.
 */
export async function listTemplates(
  options: GraphCredentials & { wabaId: string; limit?: number },
): Promise<MessageTemplate[]> {
  const call = options.fetch ?? fetch
  const version = options.apiVersion ?? DEFAULT_VERSION
  const limit = options.limit ?? 100

  const response = await call(
    `https://graph.facebook.com/${version}/${options.wabaId}/message_templates?limit=${limit}`,
    { headers: { Authorization: `Bearer ${options.accessToken}` } },
  )

  const body = (await response.json()) as {
    data?: Array<{
      name?: string
      language?: string
      status?: string
      category?: string
      components?: Array<{ type?: string; text?: string; example?: { body_text?: string[][] } }>
    }>
    error?: { message?: string; code?: number }
  }

  if (!response.ok || body.error) {
    throw new Error(`WhatsApp templates could not be listed: ${body.error?.message ?? response.status}`)
  }

  return (body.data ?? [])
    .filter((template) => (template.status ?? '').toUpperCase() === 'APPROVED')
    .map((template) => ({
      name: String(template.name ?? ''),
      language: String(template.language ?? ''),
      status: String(template.status ?? ''),
      ...(template.category ? { category: template.category } : {}),
      wabaId: options.wabaId,
      variables: variablesOf(template.components ?? []),
    }))
    .filter((template) => template.name !== '')
}

/**
 * The placeholders in a template's body.
 *
 * Meta does not report them as a list; they are `{{1}}`, `{{2}}` inside the
 * body text, with examples parked in a nested array. Reading them out here
 * means the caller knows how many values to supply before the send fails.
 */
function variablesOf(
  components: Array<{ type?: string; text?: string; example?: { body_text?: string[][] } }>,
): TemplateVariable[] {
  const body = components.find((component) => (component.type ?? '').toUpperCase() === 'BODY')
  if (!body?.text) return []

  const positions = [...body.text.matchAll(/\{\{(\d+)\}\}/g)]
    .map((match) => Number(match[1]))
    .filter((position) => Number.isFinite(position))

  const examples = body.example?.body_text?.[0] ?? []

  return [...new Set(positions)]
    .sort((a, b) => a - b)
    .map((position) => ({
      position,
      ...(examples[position - 1] ? { example: examples[position - 1] as string } : {}),
    }))
}

export interface SendTemplateOptions extends GraphCredentials {
  /** The number sending it. Must belong to the template's own WABA. */
  phoneNumberId: string
  /** In international format, digits only. */
  to: string
  template: {
    name: string
    /** Required whenever the name exists in more than one language. */
    language?: string
    /** Positional, matching `{{1}}`, `{{2}}` in the body. */
    variables?: string[]
  }
  /**
   * Threads the send into the conversation a reply will land in.
   *
   * `whatsappChannel` keys conversations by `whatsapp:{number}`, so writing
   * here with the same key means the customer's answer continues the thread
   * rather than starting a second one nobody connects to the first.
   */
  store?: Store
  /** Templates this number's account holds, for the two checks below. */
  known?: MessageTemplate[]
  /**
   * The business account the sending number belongs to.
   *
   * With `known`, this catches the pairing mistake before the request: a
   * template belongs to one WABA and can only be sent from a number on that
   * same WABA, and Meta's error for getting it wrong does not say so.
   */
  wabaId?: string
}

export interface SendResult {
  /** Meta's id for the message, for matching a later delivery receipt. */
  messageId: string
}

/**
 * Sends one template message.
 *
 * Two failures are caught before the request rather than after, because Meta's
 * own errors for them do not say what went wrong:
 *
 * - a name that exists in several languages with no language given
 * - a template that belongs to a different business account than the number
 */
export async function sendTemplate(options: SendTemplateOptions): Promise<SendResult> {
  const call = options.fetch ?? fetch
  const version = options.apiVersion ?? DEFAULT_VERSION
  const { name, variables = [] } = options.template

  const language = resolveLanguage(name, options.template.language, options.known)

  if (options.wabaId && options.known) {
    const template = options.known.find(
      (candidate) => candidate.name === name && candidate.language === language,
    )

    if (template && template.wabaId !== options.wabaId) {
      throw new Error(
        `PHONE_NUMBER_REQUIRED: "${name}" belongs to business account ${template.wabaId}, ` +
          `and this number is on ${options.wabaId}. Send it from a number on its own account.`,
      )
    }
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: options.to,
    type: 'template',
    template: {
      name,
      language: { code: language },
      ...(variables.length > 0
        ? {
            components: [
              {
                type: 'body',
                parameters: variables.map((value) => ({ type: 'text', text: value })),
              },
            ],
          }
        : {}),
    },
  }

  const response = await call(`https://graph.facebook.com/${version}/${options.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const body = (await response.json()) as {
    messages?: Array<{ id?: string }>
    error?: { message?: string; code?: number }
  }

  if (!response.ok || body.error) {
    throw new Error(explain(body.error, response.status))
  }

  const messageId = body.messages?.[0]?.id ?? ''

  // Written under the key the inbound channel uses, so the customer's reply
  // continues this conversation rather than opening a second one.
  await options.store?.appendMessage(
    `whatsapp:${options.to}`,
    {
      id: messageId || `wa_${Date.now().toString(36)}`,
      role: 'assistant',
      content: describeSend(name, variables),
      createdAt: new Date().toISOString(),
    },
    { channel: 'whatsapp' },
  )

  return { messageId }
}

/**
 * Meta's send errors, with the ones that do not say what to do spelled out.
 *
 * 133010 is the one a new number always hits. Creating a number and adding it
 * to an account is not the same as registering it with the Cloud API, and
 * nothing in the dashboard says so; the message is "Account not registered"
 * and the fix is a one-time POST nobody guesses. Meta's test numbers are not
 * registered when they are handed to you either.
 *
 * 131030 is the other one worth naming: a test number may only write to the
 * recipients on its own allow list, and the message says "not in allowed list"
 * without saying which list or where it lives.
 */
function explain(error: { message?: string; code?: number } | undefined, status: number): string {
  // Meta's messages end in a full stop and every branch continues the
  // sentence, so keeping it doubles the punctuation.
  const said = (error?.message ?? String(status)).replace(/\.\s*$/, '')

  if (error?.code === 133010) {
    return (
      `WhatsApp template send failed: ${said}. The number exists but was never registered with ` +
      'the Cloud API. Register it once: POST /{phone-number-id}/register with ' +
      '{ messaging_product: "whatsapp", pin: "<six digits>" }, where the pin is the two-step ' +
      'verification pin for that number.'
    )
  }

  if (error?.code === 131030) {
    return (
      `WhatsApp template send failed: ${said}. A test number may only message the recipients ` +
      'added to it in the dashboard, five at most. A production number has no such list.'
    )
  }

  return `WhatsApp template send failed: ${said}`
}

/**
 * Which language to send in.
 *
 * Meta requires the code, and a template name on its own is not enough when
 * the same name is approved in several languages. Guessing is worse than
 * failing: the customer gets a message in a language they may not read, and
 * the send counts against the account either way.
 */
function resolveLanguage(name: string, given: string | undefined, known?: MessageTemplate[]): string {
  if (given) return given
  if (!known) {
    throw new Error(
      'TEMPLATE_LANGUAGE_REQUIRED: pass template.language, or pass the account\'s templates as `known` so it can be resolved',
    )
  }

  const matches = known.filter((template) => template.name === name)

  if (matches.length === 0) {
    throw new Error(`no approved template called "${name}" on this account`)
  }

  if (matches.length > 1) {
    const languages = matches.map((template) => template.language).join(', ')
    throw new Error(
      `TEMPLATE_LANGUAGE_REQUIRED: "${name}" is approved in ${languages}; say which one`,
    )
  }

  return matches[0]?.language as string
}

/** What goes on the transcript. The rendered text is Meta's, not ours. */
function describeSend(name: string, variables: string[]): string {
  return variables.length > 0
    ? `[template: ${name}] ${variables.join(' | ')}`
    : `[template: ${name}]`
}

/**
 * A `send` for `runCampaign`, so a campaign can open WhatsApp conversations.
 *
 * Consent is unchanged and stays ours: Meta approving a template says the
 * wording is acceptable, not that this person agreed to hear from you.
 *
 * The campaign's rendered message text is not sent. WhatsApp will not carry
 * it; only the template and its variables go, and the variables come from the
 * recipient's own fields.
 */
export function templateSender(
  options: GraphCredentials & {
    phoneNumberId: string
    template: { name: string; language?: string; variables?: string[] }
    known?: MessageTemplate[]
    store?: Store
  },
) {
  return async function send(
    to: string,
    _message: string,
    recipient: { variables?: Record<string, string> },
  ): Promise<void> {
    // Variable names are resolved per recipient, so `['name', 'orderNumber']`
    // becomes that person's values in that order. The campaign's own
    // `variables` map is where they come from, which is the same place the
    // rendered text would have taken them.
    const variables = (options.template.variables ?? []).map((field) =>
      String(recipient.variables?.[field] ?? ''),
    )

    await sendTemplate({
      accessToken: options.accessToken,
      ...(options.apiVersion ? { apiVersion: options.apiVersion } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      phoneNumberId: options.phoneNumberId,
      to,
      template: {
        name: options.template.name,
        ...(options.template.language ? { language: options.template.language } : {}),
        variables,
      },
      ...(options.known ? { known: options.known } : {}),
      ...(options.store ? { store: options.store } : {}),
    })
  }
}
