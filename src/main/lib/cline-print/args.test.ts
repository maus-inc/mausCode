/**
 * cline-print argv + classifier tests. Flag semantics verified live
 * against cline CLI v3.0.61 (see args.ts header).
 */
import { describe, expect, it } from "vitest"
import {
  buildClinePrintArgs,
  isClineAuthErrorMessage,
  isClineInvalidModelError,
  isClineTimeoutMessage,
} from "./args"

describe("buildClinePrintArgs", () => {
  it("builds the minimal headless invocation", () => {
    const { args, promptUsed } = buildClinePrintArgs({
      prompt: "hello",
      mode: "agent",
    })
    expect(args).toEqual(["--json", "--", "hello"])
    expect(promptUsed).toBe("hello")
  })

  it("injects per-run credentials and model", () => {
    const { args } = buildClinePrintArgs({
      prompt: "hi",
      mode: "agent",
      provider: "openrouter",
      apiKey: "sk-or-test",
      model: "google/gemini-3-pro",
    })
    expect(args).toEqual([
      "-P",
      "openrouter",
      "-k",
      "sk-or-test",
      "-m",
      "google/gemini-3-pro",
      "--json",
      "--",
      "hi",
    ])
  })

  it("omits the key for local runtimes", () => {
    const { args } = buildClinePrintArgs({
      prompt: "hi",
      mode: "agent",
      provider: "ollama",
    })
    expect(args).not.toContain("-k")
    expect(args).toEqual(["-P", "ollama", "--json", "--", "hi"])
  })

  it("maps plan/ask to -p and leaves act modes bare", () => {
    for (const mode of ["plan", "ask"] as const) {
      expect(buildClinePrintArgs({ prompt: "x", mode }).args).toContain("-p")
    }
    for (const mode of ["edit", "agent", "turbo"] as const) {
      expect(buildClinePrintArgs({ prompt: "x", mode }).args).not.toContain("-p")
    }
  })

  it("passes cwd and timeout through", () => {
    const { args } = buildClinePrintArgs({
      prompt: "x",
      mode: "agent",
      cwd: "/tmp/proj",
      timeoutSec: 600,
    })
    expect(args).toEqual(["-c", "/tmp/proj", "-t", "600", "--json", "--", "x"])
  })

  it("wraps bounded history ahead of the prompt", () => {
    const { args, promptUsed } = buildClinePrintArgs({
      prompt: "follow-up",
      mode: "agent",
      historyText: "user: hi\nassistant: hello",
    })
    expect(promptUsed).toBe(
      "<conversation_history>\nuser: hi\nassistant: hello\n</conversation_history>\n\nfollow-up",
    )
    expect(args.slice(-2)).toEqual(["--", promptUsed])
  })

  it("ignores blank history", () => {
    const { promptUsed } = buildClinePrintArgs({
      prompt: "hi",
      mode: "agent",
      historyText: "   ",
    })
    expect(promptUsed).toBe("hi")
  })
})

describe("isClineAuthErrorMessage", () => {
  it("matches the live 401 text", () => {
    expect(isClineAuthErrorMessage("Incorrect API key provided")).toBe(true)
  })

  it("matches common provider auth phrasing", () => {
    expect(isClineAuthErrorMessage("401 Unauthorized")).toBe(true)
    expect(isClineAuthErrorMessage("invalid_api_key: bad key")).toBe(true)
    expect(isClineAuthErrorMessage("Unauthorized: Please sign in")).toBe(true)
  })

  it("rejects non-auth failures", () => {
    expect(
      isClineAuthErrorMessage("Cannot connect to API: Unable to connect (ConnectionRefused)"),
    ).toBe(false)
    expect(isClineAuthErrorMessage("run timed out after 4s")).toBe(false)
    expect(isClineAuthErrorMessage("")).toBe(false)
    expect(isClineAuthErrorMessage(undefined)).toBe(false)
  })
})

describe("isClineInvalidModelError", () => {
  it("matches model-not-found phrasing", () => {
    expect(isClineInvalidModelError("model not found: foo")).toBe(true)
    expect(isClineInvalidModelError("The model 'x' does not exist")).toBe(true)
  })

  it("rejects other errors", () => {
    expect(isClineInvalidModelError("Incorrect API key provided")).toBe(false)
    expect(isClineInvalidModelError("")).toBe(false)
  })
})

describe("isClineTimeoutMessage", () => {
  it("matches the live timeout text", () => {
    expect(isClineTimeoutMessage("run timed out after 4s")).toBe(true)
  })

  it("rejects other errors", () => {
    expect(isClineTimeoutMessage("Incorrect API key provided")).toBe(false)
    expect(isClineTimeoutMessage("")).toBe(false)
  })
})
