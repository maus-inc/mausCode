/**
 * openclaw-print argv + classifier tests against the live-verified
 * `agent exec` contract (openclaw CLI 2026.9.2).
 */
import { assert, describe, it } from "@effect/vitest"
import {
  buildOpenclawPrintArgs,
  isOpenclawAuthErrorMessage,
  isOpenclawInvalidModelError,
  isOpenclawTimeoutStatus,
  OPENCLAW_DEFAULT_TIMEOUT_SEC,
} from "./args"

describe("buildOpenclawPrintArgs", () => {
  it("builds the headless exec argv with stdin carriage", () => {
    const { args, promptUsed } = buildOpenclawPrintArgs({
      cwd: "/repo",
      model: "anthropic/claude-opus-5",
      prompt: "hi",
    })
    assert.deepEqual(args, [
      "agent",
      "exec",
      "--json",
      "--timeout",
      String(OPENCLAW_DEFAULT_TIMEOUT_SEC),
      "--cwd",
      "/repo",
      "--model",
      "anthropic/claude-opus-5",
      "--message-file",
      "-",
    ])
    assert.equal(promptUsed, "hi")
  })

  it("omits --model when no model is selected (config default)", () => {
    const { args } = buildOpenclawPrintArgs({ cwd: "/repo", prompt: "hi" })
    assert.ok(!args.includes("--model"))
  })

  it("floors custom timeouts and rejects non-positive values", () => {
    assert.ok(
      buildOpenclawPrintArgs({ cwd: "/x", prompt: "p", timeoutSec: 61.9 }).args.includes("61"),
    )
    const fallback = buildOpenclawPrintArgs({ cwd: "/x", prompt: "p", timeoutSec: 0 })
    assert.ok(fallback.args.includes(String(OPENCLAW_DEFAULT_TIMEOUT_SEC)))
  })

  it("wraps history ahead of the prompt (resume substitute)", () => {
    const { promptUsed } = buildOpenclawPrintArgs({
      cwd: "/x",
      prompt: "now?",
      historyText: "user: before",
    })
    assert.equal(
      promptUsed,
      "<conversation_history>\nuser: before\n</conversation_history>\n\nnow?",
    )
  })
})

describe("classifiers", () => {
  it("detects the live missing-credential message as auth", () => {
    assert.ok(
      isOpenclawAuthErrorMessage(
        "No route-compatible authentication source is configured for openai.",
      ),
    )
    assert.ok(isOpenclawAuthErrorMessage("request failed with 401 Unauthorized"))
    assert.ok(!isOpenclawAuthErrorMessage("LLM request failed: network connection error."))
    assert.ok(!isOpenclawAuthErrorMessage(""))
    assert.ok(!isOpenclawAuthErrorMessage(undefined))
  })

  it("detects unknown-model refs for the drop-model retry", () => {
    assert.ok(isOpenclawInvalidModelError("Unknown model: bogus/nope"))
    assert.ok(!isOpenclawInvalidModelError("No route-compatible authentication source"))
  })

  it("matches timeout statuses exactly", () => {
    assert.ok(isOpenclawTimeoutStatus("timeout"))
    assert.ok(!isOpenclawTimeoutStatus("error"))
  })
})
