/**
 * A PreToolUse hook that holds the permission floor when the engine would
 * otherwise auto-approve a tool call.
 *
 * Why this exists. The router passes `settingSources: ["project", "user"]`, so
 * the engine reads `.claude/settings.json` from the workspace and from the
 * user's home directory. Anthropic documents that a call an allow rule
 * auto-approves never reaches `canUseTool`, and `canUseTool` is where the app's
 * gate lives. A repository ships its own settings file, so without this hook a
 * cloned workspace carrying `{"permissions":{"allow":["Bash"]}}` would take
 * every shell command out from under the floor, and nothing in the transcript
 * would say so. The SDK calls an empty `settingSources` list "isolation mode",
 * and emptying it is not available here because the same option is what loads
 * CLAUDE.md and the project's skills.
 *
 * A hook is the enforcement point that survives an allow rule. This one only
 * ever narrows. It answers `deny` or `ask` and never `allow`, so it cannot widen
 * a posture the engine already applied, and anything it does not object to still
 * reaches `canUseTool` exactly as before. A failure inside it denies, matching
 * the evaluator's own rule that a gate which throws must not leave the caller to
 * invent a fallback.
 */
import type {
  HookCallbackMatcher,
  HookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk"
import type { AgentMode } from "../../../shared/agent-mode"
import {
  describePermissionDecision,
  type PermissionDecision,
} from "../../../shared/permissions/decision"
import { evaluateAction, type PermissionAction, permissionsPolicyPath } from "../permissions"

const HOOK_EVENT = "PreToolUse" as const

export interface PermissionFloorHookDeps {
  mode: AgentMode
  /** The directory this run is scoped to, which path checks are made against. */
  worktreePath: string
  /** Injected by a test. Defaults to the wired gate. */
  evaluate?: (action: PermissionAction) => Promise<PermissionDecision>
  /** Injected by a test. Defaults to the real policy path. */
  policyPath?: () => string
}

/** The PreToolUse matchers for one run. Spread into the SDK's `hooks` option. */
export function createPermissionFloorHook(deps: PermissionFloorHookDeps): HookCallbackMatcher[] {
  return [{ hooks: [async (input) => permissionFloorDecision(input, deps)] }]
}

/**
 * Answer the hook for one event. Exported so a test drives it without an SDK.
 *
 * An empty object means "no opinion", which leaves the call on its normal path
 * through `canUseTool`. Only a deny or an ask from the gate is passed on.
 */
export async function permissionFloorDecision(
  input: HookInput,
  deps: PermissionFloorHookDeps,
): Promise<SyncHookJSONOutput> {
  if (input.hook_event_name !== HOOK_EVENT) return {}

  const evaluate = deps.evaluate ?? evaluateAction
  const policyPath = deps.policyPath ?? permissionsPolicyPath
  let decision: PermissionDecision
  try {
    decision = await evaluate({
      toolName: input.tool_name,
      toolInput: asToolInput(input.tool_input),
      mode: deps.mode,
      worktreePath: deps.worktreePath,
    })
  } catch {
    // The evaluator already catches its own errors, so reaching this means the
    // hook itself failed. Refuse rather than let the call through ungated.
    return refuse("the permission gate did not answer, so the floor refused the call", policyPath())
  }

  if (decision.decision === "allow") return {}
  // `ask` goes out as `ask` rather than being hardened into `deny`, and that rests
  // on the pinned engine honouring the value. Checked against the bundled CLI in
  // `@anthropic-ai/claude-agent-sdk` 0.2.45, which switches on it and sets
  // `permissionBehavior` to `ask`, and throws on a value it does not know, so an
  // unsupported spelling cannot slip through as an approval. Hardening it here
  // would break the critical-path breaker's own contract, which is that Turbo asks
  // before a removal on a critical path instead of refusing it outright.
  //
  // The type declaration listing `ask` is not evidence on its own, so this is
  // worth re-reading in the bundled CLI before any SDK bump.
  return {
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      permissionDecision: decision.decision,
      permissionDecisionReason: describePermissionDecision(decision, policyPath()),
    },
  }
}

function refuse(reason: string, policyPath: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      permissionDecision: "deny",
      permissionDecisionReason: `${reason}. Rule critical-path.hook-error. Edit ${policyPath} to change the floor.`,
    },
  }
}

/**
 * The tool input as a record. The SDK types it `unknown`, and a call that hands
 * over anything else gets an empty record, which classifies as an unrecognised
 * action and so takes the residual `approval` class rather than read-only.
 */
function asToolInput(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {}
  return value as Record<string, unknown>
}
