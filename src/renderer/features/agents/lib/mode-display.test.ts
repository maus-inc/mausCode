import { describe, expect, it } from "vitest"
import type { AgentMode } from "../../../../shared/agent-mode"
import { getModeTooltip } from "./mode-display"

const MODES: AgentMode[] = ["plan", "ask", "edit", "agent", "turbo"]

describe("getModeTooltip", () => {
  it("describes the gate without qualification when the backend has one", () => {
    for (const mode of MODES) {
      // The app-gate text is the promise the evaluator keeps, so it names no
      // backend and carries no caveat.
      expect(getModeTooltip(mode, "app-gate"), mode).not.toContain("cannot block")
      expect(getModeTooltip(mode, "app-gate"), mode).not.toContain("Maus has no gate")
    }
  })

  it("says Maus cannot block when the backend has no app gate", () => {
    for (const mode of MODES) {
      const text = getModeTooltip(mode, "engine-only")
      // Nine of the ten backends give this app no per-action callback, so the
      // five descriptions above are not what a user gets there. A picker that
      // promises a blocked action on a backend that auto-approves everything is
      // the overclaim this closes, and it closes it for every mode rather than
      // for plan alone, because none of the five is enforced without the gate.
      expect(text, mode).toContain("Maus has no gate on this backend")
      expect(text.startsWith(getModeTooltip(mode, "app-gate")), mode).toBe(true)
    }
  })

  it("claims nothing about what the backend itself refuses", () => {
    // Cline and Roo take a mode flag and OpenClaw takes a prompt prefix with
    // nothing behind it, so one sentence cannot describe all nine. The caveat
    // stays about Maus, which is the part this codebase can answer for.
    for (const mode of MODES) {
      expect(getModeTooltip(mode, "engine-only"), mode).not.toContain("enforces modes itself")
    }
  })

  it("keeps the plan description read-only in its own words", () => {
    expect(getModeTooltip("plan", "app-gate")).toBe(
      "Read-only, and writes only the plan's own markdown.",
    )
  })
})
