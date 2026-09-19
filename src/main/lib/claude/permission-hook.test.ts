/**
 * Tests for the PreToolUse floor hook.
 *
 * The gate is injected, so these assert the hook's own contract rather than the
 * evaluator's: what it forwards, what it answers for each verdict, and that it
 * refuses when it cannot get an answer. `evaluator.test.ts` covers the verdicts.
 */
import type { HookInput, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk"
import { describe, expect, it } from "vitest"
import type { PermissionDecision } from "../../../shared/permissions/decision"
import type { PermissionAction } from "../permissions"
import { createPermissionFloorHook, permissionFloorDecision } from "./permission-hook"

const POLICY_PATH = "/home/tester/.mauscode/permissions.toml"

function decision(overrides: Partial<PermissionDecision> = {}): PermissionDecision {
  return {
    decision: "deny",
    rule: "destructive.policy",
    matched: "recursive-force-delete",
    reason: "a recursive force delete removes files with no way to undo it",
    ruleClass: "destructive",
    policySource: "default",
    ...overrides,
  }
}

function preToolUse(overrides: Partial<PreToolUseHookInput> = {}): HookInput {
  return {
    session_id: "session-1",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/work/mausCode",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "rm -rf /" },
    tool_use_id: "tool-1",
    ...overrides,
  }
}

/** Deps with a gate that answers `answer` and records what it was handed. */
function deps(answer: PermissionDecision | Error, seen: PermissionAction[] = []) {
  return {
    seen,
    value: {
      mode: "turbo" as const,
      worktreePath: "/work/mausCode",
      policyPath: () => POLICY_PATH,
      evaluate: async (action: PermissionAction) => {
        seen.push(action)
        if (answer instanceof Error) throw answer
        return answer
      },
    },
  }
}

describe("permissionFloorDecision", () => {
  it("passes a deny through and names the rule in the reason", async () => {
    const out = await permissionFloorDecision(preToolUse(), deps(decision()).value)
    const specific = out.hookSpecificOutput
    expect(specific?.hookEventName).toBe("PreToolUse")
    if (specific?.hookEventName !== "PreToolUse") return
    expect(specific.permissionDecision).toBe("deny")
    expect(specific.permissionDecisionReason).toContain("destructive.policy")
    expect(specific.permissionDecisionReason).toContain(POLICY_PATH)
  })

  it("passes an ask through, so an engine allow rule cannot skip the card", async () => {
    const out = await permissionFloorDecision(
      preToolUse(),
      deps(decision({ decision: "ask", rule: "critical-path.critical-delete" })).value,
    )
    const specific = out.hookSpecificOutput
    if (specific?.hookEventName !== "PreToolUse") throw new Error("expected a PreToolUse answer")
    expect(specific.permissionDecision).toBe("ask")
    expect(specific.permissionDecisionReason).toContain("critical-path.critical-delete")
  })

  it("gives no opinion on an allow, leaving the call on its normal path", async () => {
    const out = await permissionFloorDecision(
      preToolUse(),
      deps(decision({ decision: "allow", rule: "read-only.mode.turbo" })).value,
    )
    expect(out).toEqual({})
  })

  it("never answers allow, whatever the gate says", async () => {
    const out = await permissionFloorDecision(
      preToolUse(),
      deps(decision({ decision: "allow" })).value,
    )
    const specific = out.hookSpecificOutput
    if (specific?.hookEventName !== "PreToolUse") return
    expect(specific.permissionDecision).not.toBe("allow")
  })

  it("denies when the gate throws, rather than letting the call through ungated", async () => {
    const out = await permissionFloorDecision(
      preToolUse(),
      deps(new Error("the policy reader exploded")).value,
    )
    const specific = out.hookSpecificOutput
    if (specific?.hookEventName !== "PreToolUse") throw new Error("expected a PreToolUse answer")
    expect(specific.permissionDecision).toBe("deny")
    // The reason names the failure without echoing the exception's text, which
    // could carry a path or a command from the failed call.
    expect(specific.permissionDecisionReason).toContain("did not answer")
    expect(specific.permissionDecisionReason).not.toContain("exploded")
  })

  it("forwards the run's mode, worktree and tool input to the gate", async () => {
    const { seen, value } = deps(decision())
    await permissionFloorDecision(
      preToolUse({ tool_name: "Edit", tool_input: { file_path: "src/a.ts" } }),
      value,
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      toolName: "Edit",
      toolInput: { file_path: "src/a.ts" },
      mode: "turbo",
      worktreePath: "/work/mausCode",
    })
  })

  it("treats a tool input that is not an object as empty, which takes the residual class", async () => {
    const { seen, value } = deps(decision())
    await permissionFloorDecision(preToolUse({ tool_input: "rm -rf /" }), value)
    expect(seen[0]?.toolInput).toEqual({})
  })

  it("ignores every other hook event", async () => {
    const { seen, value } = deps(decision())
    const out = await permissionFloorDecision(
      {
        session_id: "session-1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: "/work/mausCode",
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: {},
        tool_use_id: "tool-1",
        tool_response: {},
      },
      value,
    )
    expect(out).toEqual({})
    expect(seen).toHaveLength(0)
  })
})

describe("createPermissionFloorHook", () => {
  it("returns one matcher whose hook is the same decision function", async () => {
    const { value } = deps(decision({ decision: "allow" }))
    const matchers = createPermissionFloorHook(value)
    expect(matchers).toHaveLength(1)
    const hook = matchers[0]?.hooks[0]
    expect(hook).toBeTypeOf("function")
    if (!hook) throw new Error("expected a hook")
    // No matcher means the hook runs for every tool, which is the point: a
    // per-tool matcher would leave the tools nobody listed ungated.
    expect(matchers[0]?.matcher).toBeUndefined()
    const out = await hook(preToolUse(), "tool-1", { signal: new AbortController().signal })
    expect(out).toEqual({})
  })

  it("denies through the matcher for a destructive call", async () => {
    const { value } = deps(decision())
    const hook = createPermissionFloorHook(value)[0]?.hooks[0]
    if (!hook) throw new Error("expected a hook")
    const out = await hook(preToolUse(), "tool-1", { signal: new AbortController().signal })
    const specific = (out as { hookSpecificOutput?: { permissionDecision?: string } })
      .hookSpecificOutput
    expect(specific?.permissionDecision).toBe("deny")
  })
})
