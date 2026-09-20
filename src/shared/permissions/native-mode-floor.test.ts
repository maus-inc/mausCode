import { describe, expect, it } from "vitest"
import type { AgentMode } from "../agent-mode"
import { nativeModeRefusal } from "./native-mode-floor"

const RESTRAINT_MODES: AgentMode[] = ["plan", "ask"]
const ACTION_MODES: AgentMode[] = ["edit", "agent", "turbo"]

describe("nativeModeRefusal", () => {
  it("refuses the two modes whose promise is restraint", () => {
    for (const mode of RESTRAINT_MODES) {
      const refusal = nativeModeRefusal(mode)
      expect(refusal, mode).not.toBeNull()
      // The text has to name the missing capability and the way out, or a user
      // reads a refusal with nothing to do about it.
      expect(refusal, mode).toContain("no permissions capability")
      expect(refusal, mode).toContain("legacy transport")
      expect(refusal?.startsWith(mode === "plan" ? "Plan mode" : "Ask mode"), mode).toBe(true)
    }
  })

  it("refuses plan for the read-only floor it cannot keep", () => {
    expect(nativeModeRefusal("plan")).toContain("read-only floor")
  })

  it("refuses ask for the card it cannot produce", () => {
    // Ask is the refusal this round added. A transport with no per-action callback
    // has nothing to interrupt, so an ask turn would run every action without a
    // card while the picker said there would be one.
    expect(nativeModeRefusal("ask")).toContain("card before each action")
  })

  it("runs the three modes whose promise is that actions happen", () => {
    for (const mode of ACTION_MODES) {
      // Refusing these would disable the engine outright. They run with the
      // engine's own posture, the gap is named in the decision record, and the
      // transport picker discloses it where a user chooses one.
      expect(nativeModeRefusal(mode), mode).toBeNull()
    }
  })

  it("has an answer for every mode the union carries", () => {
    const modes: AgentMode[] = [...RESTRAINT_MODES, ...ACTION_MODES]
    expect(modes).toHaveLength(5)
    for (const mode of modes) {
      // A mode is either refused with a reason a user can act on, or it runs.
      // The refusal is the string the transport shows, so an empty one would be
      // a refusal with nothing behind it.
      const refusal = nativeModeRefusal(mode)
      expect(refusal === null || refusal.length > 0, mode).toBe(true)
    }
  })
})
