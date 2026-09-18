/**
 * The shape a permission decision carries, and the words it shows a user.
 *
 * Both processes need this: main builds a decision, and the renderer prints its
 * rule in the approval card and in a denied tool call. Keeping the type and the
 * wording here means the rule id a test asserts is the same string a user reads.
 */
import type { PermissionRuleClass, PermissionVerdict, PolicySource } from "./policy"

/** One gate answer, with the rule that produced it. */
export interface PermissionDecision {
  decision: PermissionVerdict
  /**
   * Stable id of the check that decided. `path.<CODE>`, `plan.<id>`,
   * `allow-list.<index>`, `evaluator.<id>`, or the policy tier
   * `<class>.mode.<mode>` and `<class>.policy`.
   */
  rule: string
  /** The classifier id that put the action in its class, when one matched. */
  matched?: string
  /** One line for the user and for the model. Never quotes the command. */
  reason: string
  ruleClass: PermissionRuleClass
  policySource: PolicySource
  /** Set when the policy file exists but could not be used. */
  policyError?: string
}

/**
 * The full text a denial or an approval carries. It names the rule, the reason,
 * and which file to edit, because a denial the user cannot act on is a dead end.
 */
export function describePermissionDecision(
  decision: PermissionDecision,
  policyPath: string,
): string {
  return [decisionLine(decision), policyHint(decision, policyPath)]
    .filter((line) => line.length > 0)
    .join(" ")
}

/** Short rule text for a card subtitle or an interrupted-tool line. */
export function permissionRuleLabel(decision: PermissionDecision): string {
  return decision.matched ? `${decision.rule} (${decision.matched})` : decision.rule
}

function decisionLine(decision: PermissionDecision): string {
  if (decision.decision === "deny") {
    return `Blocked by ${permissionRuleLabel(decision)}. ${sentence(decision.reason)}`
  }
  if (decision.decision === "ask") {
    return `${sentence(decision.reason)} Rule ${permissionRuleLabel(decision)} asks first.`
  }
  return `Allowed by ${permissionRuleLabel(decision)}.`
}

/**
 * Reasons are written lowercase so they read inline in a tooltip or a log, but a
 * message that puts one after a full stop has to capitalise it.
 */
function sentence(reason: string): string {
  const text = reason.trim()
  if (text.length === 0) return ""
  const capitalised = text[0].toUpperCase() + text.slice(1)
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`
}

function policyHint(decision: PermissionDecision, policyPath: string): string {
  if (decision.policySource === "invalid-file") {
    return `${policyPath} could not be used, ${decision.policyError ?? "unknown reason"}, so the shipped floor applied.`
  }
  if (decision.policySource === "file") {
    return `${policyPath} sets this.`
  }
  return `No policy file at ${policyPath}, so the shipped floor applied.`
}
