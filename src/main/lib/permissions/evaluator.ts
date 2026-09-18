/**
 * The permission gate: one entry point, one decision, and the rule that made it.
 *
 * Every provider path that can see a tool call routes through `evaluateAction`.
 * It never throws at its caller, because a gate that throws leaves the caller to
 * invent a fallback, and the fallback this router used to invent was the SDK's
 * skip-permissions posture.
 *
 * Precedence, fixed in `.dump/app/plans/2026-09-13-permission-floor.md`:
 * path safety, then the plan-mode floor, then the mode's allow-list, then the
 * policy verdict for the class. Exfiltration sits above the allow-list, so no
 * entry a user writes can carry a secret out.
 *
 * Dependencies are injected so a test passes a fake: the real path check reaches
 * `better-sqlite3` and `electron` through `src/main/lib/db`, which CI installs
 * without native bindings.
 */
import { type AgentMode, isAgentMode } from "../../../shared/agent-mode"
import {
  type ClassifiedAction,
  classifyToolAction,
  isMarkdownPath,
  toolMatchText,
  toolPathCandidates,
} from "../../../shared/permissions/classifier"
import type { PermissionDecision } from "../../../shared/permissions/decision"
import {
  type PermissionPolicy,
  type PermissionRuleClass,
  type PermissionVerdict,
  type PolicySource,
  parseToolRule,
  resolveVerdict,
  toolRuleMatches,
} from "../../../shared/permissions/policy"
import { describeError, type LoadedPolicy } from "./policy-file"

/** One resolved agent action, handed to the gate by a provider router. */
export interface PermissionAction {
  toolName: string
  toolInput: Record<string, unknown>
  mode: AgentMode
  /** The directory this run is scoped to. Tool paths are checked against it. */
  worktreePath: string
}

/** Answer from a path containment check. */
export type PathCheck =
  | { ok: true; relative: string }
  | { ok: false; code: string; message: string }

export interface PermissionEvaluatorDeps {
  loadPolicy: () => Promise<LoadedPolicy>
  checkPath: (worktreePath: string, candidatePath: string) => Promise<PathCheck>
}

export interface PermissionEvaluator {
  evaluateAction: (action: PermissionAction) => Promise<PermissionDecision>
}

/** A check's answer before the policy provenance is stamped onto it. */
type GateOutcome = Omit<PermissionDecision, "policySource" | "matched">

interface DecisionContext {
  policySource: PolicySource
  policyError?: string
}

type PathOutcome = { ok: true; relative?: string } | { ok: false; code: string; message: string }

export function createPermissionEvaluator(deps: PermissionEvaluatorDeps): PermissionEvaluator {
  return {
    evaluateAction: async (action) => {
      const loaded = await loadSafely(deps)
      const context: DecisionContext = {
        policySource: loaded.source,
        ...(loaded.error === undefined ? {} : { policyError: loaded.error }),
      }
      try {
        return await decide(action, loaded.policy, deps.checkPath, context)
      } catch (error) {
        return stamp(
          outcome("deny", "evaluator.error", describeError(error), "approval"),
          "evaluator.error",
          context,
        )
      }
    },
  }
}

/**
 * The policy this gate falls back to when loading one throws. Every class
 * denies, reads included: an unexpected failure in the thing that decides what
 * is allowed must not leave the permissive defaults in charge.
 *
 * `readPolicyFile` handles the expected failures itself, an absent file and an
 * unparseable one, and answers the shipped floor for those, so this only fires
 * on a bug or on an error the reader did not anticipate.
 */
const UNREADABLE_POLICY: PermissionPolicy = {
  classes: {
    "read-only": "deny",
    approval: "deny",
    destructive: "deny",
    network: "deny",
    exfiltration: "deny",
  },
  modes: { plan: {}, ask: {}, edit: {}, agent: {}, turbo: {} },
}

/** Load the policy, or deny everything when loading throws. */
async function loadSafely(deps: PermissionEvaluatorDeps): Promise<LoadedPolicy> {
  try {
    return await deps.loadPolicy()
  } catch (error) {
    return { policy: UNREADABLE_POLICY, source: "invalid-file", error: describeError(error) }
  }
}

async function decide(
  action: PermissionAction,
  policy: PermissionPolicy,
  checkPath: PermissionEvaluatorDeps["checkPath"],
  context: DecisionContext,
): Promise<PermissionDecision> {
  const classified = classifyToolAction(action.toolName, action.toolInput)

  // Refuse a mode this app has no floor for, loudly. The routers validate with
  // `agentModeSchema`, so this only fires for a caller that skipped validation,
  // and PA-8 in `.dump/app/decisions/provisional-assumptions.md` says a mode
  // that cannot be honoured fails rather than falling back to a wider posture.
  if (!isAgentMode(action.mode)) {
    return stamp(
      outcome(
        "deny",
        "mode.unknown",
        `no permission floor is defined for mode "${action.mode}"`,
        classified.ruleClass,
      ),
      classified.ruleId,
      context,
    )
  }

  const paths = await checkActionPaths(action, checkPath)
  if (!paths.ok) {
    return stamp(
      outcome("deny", `path.${paths.code}`, paths.message, classified.ruleClass),
      classified.ruleId,
      context,
    )
  }

  const planOutcome =
    action.mode === "plan" ? decidePlanMode(action, classified, paths.relative) : null
  if (planOutcome) return stamp(planOutcome, classified.ruleId, context)

  const allowListed = matchAllowList(policy, action, classified.ruleClass, paths.relative)
  if (allowListed) return stamp(allowListed, classified.ruleId, context)

  const resolved = resolveVerdict(policy, action.mode, classified.ruleClass)
  return stamp(
    outcome(resolved.verdict, resolved.rule, classified.reason, classified.ruleClass),
    classified.ruleId,
    context,
  )
}

function stamp(
  gateOutcome: GateOutcome,
  matched: string,
  context: DecisionContext,
): PermissionDecision {
  return { ...gateOutcome, matched, ...context }
}

async function checkActionPaths(
  action: PermissionAction,
  checkPath: PermissionEvaluatorDeps["checkPath"],
): Promise<PathOutcome> {
  let relative: string | undefined
  for (const candidate of toolPathCandidates(action.toolInput)) {
    const check = await checkPath(action.worktreePath, candidate)
    if (!check.ok) return { ok: false, code: check.code, message: check.message }
    if (relative === undefined) relative = check.relative
  }
  return { ok: true, relative }
}

/**
 * Plan mode narrows only. Read-only tools fall through to the class verdict and
 * allow; markdown edits are the one write plan mode permits, which is the
 * behaviour the router hardcoded before this gate existed. Everything else is
 * refused, and the refusal names what plan mode is for.
 */
function decidePlanMode(
  action: PermissionAction,
  classified: ClassifiedAction,
  relativePath: string | undefined,
): GateOutcome | null {
  if (action.toolName === "ExitPlanMode") {
    return outcome(
      "deny",
      "plan.exit-plan-mode",
      "plan mode presents the plan and stops, and the user gives the command to implement it",
      classified.ruleClass,
    )
  }
  if (classified.ruleClass === "read-only") return null
  if (classified.ruleClass !== "approval") {
    return outcome(
      "deny",
      "plan.read-only",
      `plan mode is read-only, and this action is ${classified.ruleClass}`,
      classified.ruleClass,
    )
  }
  if (typeof action.toolInput.command === "string") {
    return outcome("deny", "plan.no-shell", "plan mode does not run shell commands", "approval")
  }
  if (relativePath !== undefined && isMarkdownPath(relativePath)) {
    return outcome("allow", "plan.markdown-edit", "plan mode allows markdown edits", "approval")
  }
  return outcome(
    "deny",
    "plan.markdown-only",
    'only ".md" files can be modified in plan mode',
    "approval",
  )
}

/**
 * The mode's allow-list. Exfiltration is checked before the list, so an entry
 * cannot become a way to ship a secret, and a malformed entry is skipped rather
 * than treated as a wildcard.
 */
function matchAllowList(
  policy: PermissionPolicy,
  action: PermissionAction,
  ruleClass: PermissionRuleClass,
  relativePath: string | undefined,
): GateOutcome | null {
  if (ruleClass === "exfiltration") return null

  const rules = policy.modes[action.mode].allow_tools ?? []
  if (rules.length === 0) return null

  const matchText = toolMatchText(action.toolName, action.toolInput, relativePath)
  for (let index = 0; index < rules.length; index += 1) {
    const entry = rules[index]
    if (entry === undefined) continue
    const rule = parseToolRule(entry)
    if (!rule || !toolRuleMatches(rule, action.toolName, matchText)) continue
    return outcome(
      "allow",
      `allow-list.${index}`,
      `the ${action.mode} allow-list entry "${entry}" covers this action`,
      ruleClass,
    )
  }
  return null
}

function outcome(
  decision: PermissionVerdict,
  rule: string,
  reason: string,
  ruleClass: PermissionRuleClass,
): GateOutcome {
  return { decision, rule, reason, ruleClass }
}
