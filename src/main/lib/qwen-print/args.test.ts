/**
 * qwen-print argv builder tests: mode mapping, positional-vs-equals
 * prompt carriage, auth/model/session flags, fallback subset, and the
 * resume/unknown-flag/auth classifiers.
 */
import { describe, expect, it } from "vitest"
import {
  buildQwenPrintArgs,
  buildQwenPrintFallbackArgs,
  isQwenAuthError,
  isQwenInvalidModelError,
  isQwenResumeError,
  isQwenUnknownFlagError,
  QWEN_ASK_EXCLUDE_TOOLS,
} from "./args"

describe("buildQwenPrintArgs", () => {
  it("carries the prompt positionally first with headless flags", () => {
    const { args } = buildQwenPrintArgs({ prompt: "hello", mode: "agent" })
    expect(args[0]).toBe("hello")
    expect(args).toContain("--output-format")
    expect(args).toContain("stream-json")
    expect(args).toContain("--include-partial-messages")
    expect(args).toContain("--channel")
  })

  it("maps plan to approval-mode plan without excludes", () => {
    const { args } = buildQwenPrintArgs({ prompt: "p", mode: "plan" })
    expect(args).toContain("plan")
    expect(args).not.toContain("--exclude-tools")
  })

  it("maps ask to default plus the writer/shell/subagent denylist", () => {
    const { args } = buildQwenPrintArgs({ prompt: "p", mode: "ask" })
    const i = args.indexOf("--approval-mode")
    expect(args[i + 1]).toBe("default")
    const j = args.indexOf("--exclude-tools")
    expect(j).toBeGreaterThan(-1)
    for (const tool of QWEN_ASK_EXCLUDE_TOOLS) {
      expect(args[j + 1]).toContain(tool)
    }
    expect(args[j + 1]).toContain("write_file")
    expect(args[j + 1]).toContain("run_shell_command")
    expect(args[j + 1]).toContain("agent")
  })

  it("maps edit/agent/turbo to auto-edit/auto/yolo", () => {
    for (const [mode, expected] of [
      ["edit", "auto-edit"],
      ["agent", "auto"],
      ["turbo", "yolo"],
    ] as const) {
      const { args } = buildQwenPrintArgs({ prompt: "p", mode })
      const i = args.indexOf("--approval-mode")
      expect(args[i + 1]).toBe(expected)
    }
  })

  it("routes dash-leading prompts through the --prompt= equals form", () => {
    const { args } = buildQwenPrintArgs({ prompt: "--weird", mode: "agent" })
    expect(args[0]).not.toBe("--weird")
    expect(args).toContain("--prompt=--weird")
  })

  it("passes model/auth/resume/session flags verbatim", () => {
    const { args } = buildQwenPrintArgs({
      prompt: "p",
      mode: "agent",
      model: "qwen3-coder-plus",
      authType: "openai",
      apiKey: "sk-x",
      baseUrl: "https://example.test/v1",
      resumeId: "sid-1",
    })
    expect(args).toContain("-m")
    expect(args).toContain("qwen3-coder-plus")
    expect(args).toContain("--auth-type")
    expect(args).toContain("--openai-api-key")
    expect(args).toContain("sk-x")
    expect(args).toContain("--openai-base-url")
    expect(args).toContain("--resume")
    expect(args).toContain("sid-1")
  })

  it("prefers resume over a fresh session id", () => {
    const { args } = buildQwenPrintArgs({
      prompt: "p",
      mode: "agent",
      resumeId: "sid-1",
      newSessionId: "fresh",
    })
    expect(args).toContain("--resume")
    expect(args).not.toContain("--session-id")
  })

  it("emits --session-id for fresh turns", () => {
    const { args } = buildQwenPrintArgs({
      prompt: "p",
      mode: "agent",
      newSessionId: "fresh",
    })
    expect(args).toContain("--session-id")
    expect(args).toContain("fresh")
  })

  it("repeats --include-directories per dir and validates maxTurns", () => {
    const { args } = buildQwenPrintArgs({
      prompt: "p",
      mode: "agent",
      includeDirs: ["/a", "/b"],
      maxTurns: 30,
    })
    expect(args.filter((a) => a === "--include-directories")).toHaveLength(2)
    expect(args).toContain("30")
    const bad = buildQwenPrintArgs({ prompt: "p", mode: "agent", maxTurns: 0 })
    expect(bad.args).not.toContain("--max-session-turns")
  })
})

describe("buildQwenPrintFallbackArgs", () => {
  it("keeps prompt/auth/model/resume and drops newer flags", () => {
    const { args } = buildQwenPrintArgs({
      prompt: "hello",
      mode: "ask",
      model: "m",
      authType: "openai",
      apiKey: "k",
      newSessionId: "s",
      includeDirs: ["/a"],
      maxTurns: 5,
    })
    const fallback = buildQwenPrintFallbackArgs(args)
    expect(fallback[0]).toBe("hello")
    expect(fallback).toContain("--output-format")
    expect(fallback).toContain("--auth-type")
    expect(fallback).toContain("--openai-api-key")
    expect(fallback).toContain("-m")
    expect(fallback).toContain("--session-id")
    expect(fallback).not.toContain("--channel")
    expect(fallback).not.toContain("--include-partial-messages")
    expect(fallback).not.toContain("--exclude-tools")
    expect(fallback).not.toContain("--include-directories")
    expect(fallback).not.toContain("--max-session-turns")
  })

  it("preserves the --prompt= equals form", () => {
    const { args } = buildQwenPrintArgs({ prompt: "-x", mode: "agent" })
    const fallback = buildQwenPrintFallbackArgs(args)
    expect(fallback).toContain("--prompt=-x")
  })
})

describe("classifiers", () => {
  it("matches stale-resume diagnostics", () => {
    expect(isQwenResumeError('No saved session found with title "abc".')).toBe(true)
    expect(isQwenResumeError("other")).toBe(false)
    expect(isQwenResumeError(null)).toBe(false)
  })

  it("matches provider unknown-model failures", () => {
    expect(isQwenInvalidModelError("Unknown model: foo-v9")).toBe(true)
    expect(isQwenInvalidModelError("The model xyz does not exist")).toBe(true)
    expect(isQwenInvalidModelError("boom")).toBe(false)
  })

  it("matches yargs unknown-argument diagnostics", () => {
    expect(isQwenUnknownFlagError("Unknown argument: foo")).toBe(true)
    expect(isQwenUnknownFlagError("Unknown arguments: a, b")).toBe(true)
    expect(isQwenUnknownFlagError("Usage: qwen")).toBe(false)
  })

  it("matches auth failures but not policy denials", () => {
    expect(isQwenAuthError("No auth type is selected. Please configure an auth type")).toBe(true)
    expect(isQwenAuthError("Missing API key for OpenAI-compatible auth.")).toBe(true)
    expect(isQwenAuthError("Request failed: 401 Unauthorized")).toBe(true)
    expect(isQwenAuthError("Invalid API key provided")).toBe(true)
    expect(
      isQwenAuthError(
        'Qwen Code requires permission to use "write_file", but that permission was declined.',
      ),
    ).toBe(false)
    expect(isQwenAuthError("")).toBe(false)
  })
})
