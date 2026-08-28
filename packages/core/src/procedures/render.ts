import type { Contact } from '../actions/types.js'
import { VARIABLE_REFERENCE, type Decision, type Procedure, type Step } from './types.js'

export interface VariableScope {
  contact?: Contact
  /** Anything else the host wants available as `{{name}}`. */
  extra?: Record<string, string | number | boolean | undefined>
}

/**
 * Resolves `{{contact.email}}` and friends.
 *
 * An unresolved token is replaced with a phrase rather than left as braces,
 * because a model shown `{{contact.email}}` will cheerfully write those braces
 * into its reply to the customer.
 */
export function resolveVariables(text: string, scope: VariableScope): string {
  return text.replace(VARIABLE_REFERENCE, (_, path: string) => {
    const value = lookup(path, scope)
    if (value === undefined || value === null || value === '') return '(not known)'
    return String(value)
  })
}

function lookup(path: string, scope: VariableScope): unknown {
  const parts = path.split('.')
  const head = parts[0]

  if (head === 'contact' || head === 'user') {
    const contact = scope.contact
    if (!contact) return undefined

    // `contact.custom_attributes.plan` and `contact.plan` both reach attributes.
    const rest = parts.slice(1).filter((part) => part !== 'custom_attributes')
    const key = rest.join('.')

    if (key === 'name') return contact.name
    if (key === 'email') return contact.email
    if (key === 'phonenumber' || key === 'phone') return contact.phone
    if (key === 'id') return contact.id
    if (key === 'verified') return contact.verified
    return contact.attributes?.[key]
  }

  return scope.extra?.[path]
}

/**
 * Renders procedures for the system prompt.
 *
 * They go in as text the model reads and follows rather than as a state machine
 * it is driven through. A support conversation does not run in a straight line:
 * customers answer three questions at once, change their mind, or ask something
 * unrelated halfway. A rigid runner handles none of that gracefully, while an
 * ordered plan the model holds in mind survives all of it.
 */
export function renderProcedures(procedures: Procedure[], scope: VariableScope): string {
  if (procedures.length === 0) return ''

  const lines: string[] = [
    'Procedures:',
    'If the conversation matches one of the triggers below, follow that procedure’s steps in order.',
    'Work through one step at a time and wait for the customer where a step asks them something.',
    'Steps that name an action with @ mean: call that action at that point.',
    'Follow at most one procedure at a time, and do not start one whose trigger does not match.',
    '',
  ]

  for (const procedure of procedures) {
    lines.push(`### ${procedure.name}`)
    lines.push(`Trigger: ${resolveVariables(procedure.trigger, scope)}`)
    lines.push('Steps:')
    lines.push(...renderSteps(procedure.steps, scope))
    lines.push('')
  }

  return lines.join('\n').trim()
}

function renderSteps(steps: Step[], scope: VariableScope): string[] {
  const lines: string[] = []
  let number = 1

  for (const step of steps) {
    if (typeof step === 'string') {
      lines.push(`${number++}. ${resolveVariables(step, scope)}`)
      continue
    }

    const decision = step as Decision
    lines.push(`${number++}. Decide:`)
    for (const [position, branch] of decision.branches.entries()) {
      const keyword = position === 0 ? 'If' : 'Otherwise if'
      lines.push(
        `   - ${keyword} ${resolveVariables(branch.if, scope)}: ${resolveVariables(branch.then, scope)}`,
      )
    }
    if (decision.otherwise) {
      lines.push(`   - Otherwise: ${resolveVariables(decision.otherwise, scope)}`)
    }
    lines.push('   Then carry on with the next step.')
  }

  return lines
}
