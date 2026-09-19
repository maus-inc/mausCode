/**
 * The SDK posture each mode gets.
 *
 * The whole point of this module is what it refuses to return, so the tests
 * assert the absence of the bypass postures as directly as they assert the
 * mapping. Roadmap step 10 section 10 and `AGENTS.md` section 8 both name them
 * under Never.
 */
import { describe, expect, it } from "vitest"
import { AGENT_MODES, type AgentMode } from "../../../shared/agent-mode"
import { sdkPermissionMode } from "./permission-mode"

/** Spellings that would take actions out from under the gate. */
const BYPASS_POSTURES = ["bypassPermissions", "acceptEdits", "dontAsk"]

describe("sdkPermissionMode", () => {
  it("gives plan mode the engine's own plan posture", () => {
    expect(sdkPermissionMode("plan")).toBe("plan")
  })

  it.each(["ask", "edit", "agent", "turbo"] as const)(
    "gives %s the posture where every action reaches canUseTool",
    (mode) => {
      expect(sdkPermissionMode(mode)).toBe("default")
    },
  )

  it("covers every mode the app defines", () => {
    for (const mode of AGENT_MODES) {
      expect(typeof sdkPermissionMode(mode)).toBe("string")
    }
  })

  it("never answers a posture that auto-approves behind the gate", () => {
    for (const mode of AGENT_MODES) {
      expect(BYPASS_POSTURES).not.toContain(sdkPermissionMode(mode))
    }
  })

  it("refuses a mode it has no floor for instead of widening it", () => {
    // PA-8 in `.dump/app/decisions/provisional-assumptions.md`: a mode this app
    // cannot honour fails loudly rather than falling back to a wider posture.
    const unknown = "yolo" as AgentMode
    expect(() => sdkPermissionMode(unknown)).toThrow(/yolo/)
    expect(() => sdkPermissionMode(unknown)).toThrow(/widen/i)
  })
})
