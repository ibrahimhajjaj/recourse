export { createHelpdesk, type Helpdesk, type HelpdeskOptions, type OpenTicketInput } from './service.js'
export { DEFAULT_STATUSES, defaultStatusFor, validateStatuses } from './statuses.js'
export { routeTicket, type RoutingRule, type RoutingCondition, type RoutingResult } from './routing.js'
export { assignTicket, loadOf, type AssignmentAlgorithm, type Availability, type AssignOptions } from './assignment.js'
export {
  STATUS_CATEGORIES,
  RESOLVED_CATEGORIES,
  type StatusCategory,
  type TicketStatus,
  type Team,
  type Ticket,
  type TicketCustomer,
  type TicketMessage,
  type TicketMessageType,
  type TicketMessageSender,
  type TicketFilter,
} from './types.js'
