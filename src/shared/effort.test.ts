import { describe, expect, it } from "vitest"
import { CODEX_REASONING_EFFORTS } from "./codex-model-id"
import { EFFORT_LEVELS, formatEffortLabel, isEffortLevel } from "./effort"

describe("the shared effort vocabulary", () => {
  it("keeps the levels the pinned Claude Agent SDK declares", () => {
    // `Options.effort` at 0.3.270 is low | medium | high | xhigh | max. This
    // fails on purpose if the list is edited without re-reading the SDK type.
    expect([...EFFORT_LEVELS]).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  it("keeps every Codex effort inside the shared vocabulary", () => {
    for (const effort of CODEX_REASONING_EFFORTS) {
      expect(isEffortLevel(effort)).toBe(true)
    }
  })

  it("accepts the advertised levels and nothing else", () => {
    expect(EFFORT_LEVELS.every((level) => isEffortLevel(level))).toBe(true)
    expect(isEffortLevel("default")).toBe(false)
    expect(isEffortLevel("")).toBe(false)
    expect(isEffortLevel("MAX")).toBe(false)
  })

  it("labels the levels the picker already labelled them", () => {
    expect(formatEffortLabel("low")).toBe("Low")
    expect(formatEffortLabel("medium")).toBe("Medium")
    expect(formatEffortLabel("high")).toBe("High")
    // The one level whose capitalized form is not the label the Codex picker
    // shipped, and the reason this is a function rather than a capitalize call.
    expect(formatEffortLabel("xhigh")).toBe("Extra High")
    expect(formatEffortLabel("max")).toBe("Max")
  })
})
