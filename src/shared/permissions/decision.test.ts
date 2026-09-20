/**
 * The words a decision shows a user.
 *
 * Roadmap step 10 section 10 requires a denial to name the rule, and a denial
 * the user cannot act on is a dead end, so these assert the rule id, the reason
 * and the file to edit all reach the message.
 */
import { describe, expect, it } from "vitest"
import type { PermissionDecision } from "./decision"
import { describePermissionDecision, permissionRuleLabel } from "./decision"

const POLICY_PATH = "/home/u/.mauscode/permissions.toml"

function decision(partial: Partial<PermissionDecision> = {}): PermissionDecision {
  return {
    decision: "deny",
    rule: "destructive.policy",
    reason: "a recursive force delete removes files with no way to undo it",
    ruleClass: "destructive",
    policySource: "default",
    ...partial,
  }
}

describe("permissionRuleLabel", () => {
  it("is the rule id on its own when nothing matched a pattern", () => {
    expect(permissionRuleLabel(decision())).toBe("destructive.policy")
  })

  it("appends the classifier id when a pattern matched", () => {
    expect(permissionRuleLabel(decision({ matched: "recursive-force-delete" }))).toBe(
      "destructive.policy (recursive-force-delete)",
    )
  })
})

describe("describePermissionDecision", () => {
  it("names the rule on a denial", () => {
    const text = describePermissionDecision(decision(), POLICY_PATH)
    expect(text).toContain("Blocked by destructive.policy")
    expect(text).toContain("A recursive force delete removes files with no way to undo it.")
  })

  it("names the matched pattern too, so the user sees what fired", () => {
    const text = describePermissionDecision(decision({ matched: "forced-git-push" }), POLICY_PATH)
    expect(text).toContain("destructive.policy (forced-git-push)")
  })

  it("names the rule on an ask", () => {
    const text = describePermissionDecision(
      decision({ decision: "ask", rule: "destructive.mode.ask", ruleClass: "destructive" }),
      POLICY_PATH,
    )
    expect(text).toContain("destructive.mode.ask asks first")
    // The reason is written lowercase in the classifier but reads as a sentence
    // here, so it gets a capital and its own full stop before the rule.
    expect(text).toContain("A recursive force delete removes files with no way to undo it. Rule")
  })

  it("names the rule on an allow", () => {
    const text = describePermissionDecision(
      decision({ decision: "allow", rule: "allow-list.1", ruleClass: "approval" }),
      POLICY_PATH,
    )
    expect(text).toContain("Allowed by allow-list.1")
  })

  it("points at the file when the file decided", () => {
    const text = describePermissionDecision(decision({ policySource: "file" }), POLICY_PATH)
    expect(text).toContain(`${POLICY_PATH} sets this.`)
  })

  it("says the floor applied when there is no file", () => {
    const text = describePermissionDecision(decision(), POLICY_PATH)
    expect(text).toContain(`No policy file at ${POLICY_PATH}`)
    expect(text).toContain("shipped floor applied")
  })

  it("names the failure when the file exists but could not be used", () => {
    const text = describePermissionDecision(
      decision({ policySource: "invalid-file", policyError: "line 2: malformed key" }),
      POLICY_PATH,
    )
    expect(text).toContain("could not be used")
    expect(text).toContain("line 2: malformed key")
  })

  it("never quotes the command the model wanted to run", () => {
    const text = describePermissionDecision(
      decision({ reason: "a recursive force delete removes files with no way to undo it" }),
      POLICY_PATH,
    )
    expect(text).not.toContain("rm -rf")
  })
})
