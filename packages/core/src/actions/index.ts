export { defineAction, actionsToTools, fieldsToSchema, type ToolBuildOptions } from './define.js'
export type { Action, ActionContext, ActionField, ActionInput, ActionResult, Contact } from './types.js'

export { collectLeads, collectData, type CollectLeadsOptions, type CollectDataOptions } from './builtin/capture.js'
export { escalate, type EscalateOptions, type EscalationRequest } from './builtin/escalate.js'
export { webSearch, type WebSearchOptions } from './builtin/search.js'
export { httpAction, type HttpActionOptions } from './builtin/http.js'
export { clientAction, suggestedMessages, type ClientActionOptions, type SuggestionsOptions } from './builtin/client.js'
export {
  customButton,
  customForm,
  formSchema,
  type CustomButtonOptions,
  type CustomFormOptions,
  type FormField,
} from './builtin/ui.js'
export {
  slackNotify,
  scheduleMeeting,
  type SlackNotifyOptions,
  type BookingOptions,
} from './builtin/notify.js'
export {
  stripeBilling,
  shopifyOrders,
  type StripeOptions,
  type ShopifyOptions,
} from './builtin/commerce.js'
export {
  liveChat,
  transferToPhone,
  salesforceCases,
  type LiveChatOptions,
  type TransferToPhoneOptions,
  type SalesforceCaseOptions,
} from './builtin/handoff.js'
