/**
 * Drift tests for the Codex default. The bug this file exists to prevent is
 * two constants disagreeing about the default: `"gpt-5.5"` in the main router
 * against `"gpt-5.5/high"` in the renderer transport, verified 2026-09-15.
 * Both now read this module, so a test that pins the shared values against
 * the picker list they have to stay valid for is what keeps the pair honest.
 */
import { describe, expect, it } from "vitest"
import {
  CODEX_MODELS,
  CODEX_REASONING_EFFORTS,
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_CODEX_UI_MODEL,
  isCodexReasoningEffort,
} from "./codex-model-id"

describe("codex default model and effort", () => {
  it("keeps the model id and the effort as separate values", () => {
    expect(DEFAULT_CODEX_UI_MODEL).not.toContain("/")
    expect(DEFAULT_CODEX_REASONING_EFFORT).not.toContain("/")
  })

  it("names a model the renderer picker actually offers", () => {
    const ids = CODEX_MODELS.map((model) => model.id)
    expect(ids).toContain(DEFAULT_CODEX_UI_MODEL)
  })

  it("names an effort that model supports", () => {
    const model = CODEX_MODELS.find((entry) => entry.id === DEFAULT_CODEX_UI_MODEL)
    expect(model?.thinkings).toContain(DEFAULT_CODEX_REASONING_EFFORT)
  })

  it("keeps the default effort inside the effort set", () => {
    expect(CODEX_REASONING_EFFORTS).toContain(DEFAULT_CODEX_REASONING_EFFORT)
  })

  it("accepts every advertised effort and nothing else", () => {
    for (const effort of CODEX_REASONING_EFFORTS) {
      expect(isCodexReasoningEffort(effort)).toBe(true)
    }
    expect(isCodexReasoningEffort("extreme")).toBe(false)
    expect(isCodexReasoningEffort("")).toBe(false)
  })
})
