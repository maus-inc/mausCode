/**
 * grok native-print argv builder tests: mode/flag mapping, prompt-file
 * overflow, fallback stripping/rewriting, and retry-error matchers.
 */
import { assert, it } from "@effect/vitest"
import {
  buildGrokPrintArgs,
  buildGrokPrintFallbackArgs,
  GROK_ASK_TOOLS,
  GROK_PROMPT_FILE_CHARS,
  isGrokInvalidModelError,
  isGrokResumeError,
  isGrokUnknownFlagError,
} from "./args"

it("maps plan/ask to permission-mode/tools and edit/agent/turbo to approve", () => {
  const plan = buildGrokPrintArgs({ mode: "plan", prompt: "hi" }).args
  assert.deepEqual(
    plan.slice(plan.indexOf("--permission-mode"), plan.indexOf("--permission-mode") + 2),
    ["--permission-mode", "plan"],
  )
  assert.ok(!plan.includes("--always-approve"))

  const ask = buildGrokPrintArgs({ mode: "ask", prompt: "hi" }).args
  assert.deepEqual(ask.slice(ask.indexOf("--tools"), ask.indexOf("--tools") + 2), [
    "--tools",
    GROK_ASK_TOOLS,
  ])
  assert.ok(!ask.includes("--always-approve"))

  for (const mode of ["edit", "agent"] as const) {
    const { args } = buildGrokPrintArgs({ mode, prompt: "hi" })
    assert.ok(args.includes("--always-approve"))
    assert.ok(!args.includes("--permission-mode"))
  }
  const turbo = buildGrokPrintArgs({ mode: "turbo", prompt: "hi" }).args
  assert.ok(turbo.includes("--always-approve"))
  assert.deepEqual(
    turbo.slice(turbo.indexOf("--permission-mode"), turbo.indexOf("--permission-mode") + 2),
    ["--permission-mode", "bypassPermissions"],
  )
})

it("always passes streaming-json + no-auto-update and threads model/resume/cwd", () => {
  const { args } = buildGrokPrintArgs({
    model: "grok-4.6",
    mode: "agent",
    resumeId: "ses-1",
    cwd: "/repo",
    prompt: "hi",
  })
  assert.deepEqual(
    args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 2),
    ["--output-format", "streaming-json"],
  )
  assert.ok(args.includes("--no-auto-update"))
  assert.deepEqual(args.slice(args.indexOf("-m"), args.indexOf("-m") + 2), ["-m", "grok-4.6"])
  assert.deepEqual(args.slice(args.indexOf("-r"), args.indexOf("-r") + 2), ["-r", "ses-1"])
  assert.deepEqual(args.slice(args.indexOf("--cwd"), args.indexOf("--cwd") + 2), ["--cwd", "/repo"])
  assert.deepEqual(args.slice(0, 2), ["-p", "hi"])
})

it("passes client-chosen UUIDs via -s and rejects non-UUIDs", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000"
  const { args } = buildGrokPrintArgs({
    mode: "agent",
    prompt: "hi",
    newSessionId: uuid,
  })
  assert.deepEqual(args.slice(args.indexOf("-s"), args.indexOf("-s") + 2), ["-s", uuid])
  assert.ok(!args.includes("-r"))
  assert.throws(() => buildGrokPrintArgs({ mode: "agent", prompt: "hi", newSessionId: "nope" }))
  // resumeId wins over newSessionId (CLI rejects -s with -r).
  const resumed = buildGrokPrintArgs({
    mode: "agent",
    prompt: "hi",
    resumeId: "ses-1",
    newSessionId: uuid,
  }).args
  assert.ok(resumed.includes("-r"))
  assert.ok(!resumed.includes("-s"))
})

it("routes overlong prompts to --prompt-file with splice-at-1 argv", () => {
  const prompt = "x".repeat(GROK_PROMPT_FILE_CHARS + 1)
  const { args, promptFileText } = buildGrokPrintArgs({
    mode: "agent",
    prompt,
  })
  assert.equal(promptFileText, prompt)
  assert.equal(args[0], "--prompt-file")
  assert.ok(!args.includes(prompt))
})

it("keeps short prompts inline on -p", () => {
  const { args, promptFileText } = buildGrokPrintArgs({
    mode: "agent",
    prompt: "short",
  })
  assert.equal(promptFileText, undefined)
  assert.deepEqual(args.slice(0, 2), ["-p", "short"])
})

it("strips newer flags and rewrites prompt-file to -p on fallback", () => {
  const invocation = buildGrokPrintArgs({
    model: "grok-4.6",
    mode: "plan",
    resumeId: "ses-1",
    cwd: "/repo",
    prompt: "y".repeat(GROK_PROMPT_FILE_CHARS + 1),
  })
  assert.equal(invocation.args[0], "--prompt-file")
  const prompt = "y".repeat(GROK_PROMPT_FILE_CHARS + 1)
  const spawned = [invocation.args[0]!, "/tmp/grok-prompt-1.txt", ...invocation.args.slice(1)]
  const fallback = buildGrokPrintFallbackArgs(spawned, prompt)
  assert.ok(!fallback.includes("--no-auto-update"))
  assert.ok(!fallback.includes("--permission-mode"))
  assert.ok(!fallback.includes("plan"))
  assert.deepEqual(fallback.slice(0, 2), ["-p", prompt])
  for (const kept of [
    "-m",
    "grok-4.6",
    "-r",
    "ses-1",
    "--cwd",
    "/repo",
    "--output-format",
    "streaming-json",
  ]) {
    assert.ok(fallback.includes(kept))
  }
})

it("does not mistake prose for retryable errors", () => {
  assert.equal(isGrokResumeError("it is presumed complete"), false)
  assert.equal(isGrokResumeError("cannot resume session ses-1"), true)
  assert.equal(isGrokInvalidModelError("remodelled output"), false)
})

it("leaves prompt text alone when it equals --prompt-file", () => {
  const out = buildGrokPrintFallbackArgs(
    ["-p", "--prompt-file", "--cwd", "/tmp/x", "--always-approve"],
    "--prompt-file",
  )
  assert.deepEqual(out, ["-p", "--prompt-file", "--cwd", "/tmp/x", "--always-approve"])
})

it("matches resume, invalid-model, and unknown-flag errors", () => {
  assert.ok(isGrokResumeError("Error: session 'abc' not found"))
  assert.ok(isGrokResumeError("Failed to resume conversation"))
  assert.ok(isGrokResumeError("no session with id xyz"))
  assert.ok(!isGrokResumeError("mock failure: quota exceeded"))
  assert.ok(isGrokInvalidModelError("error: unknown model 'foo-9'"))
  assert.ok(isGrokInvalidModelError("model 'bar' not available"))
  assert.ok(!isGrokInvalidModelError("mock failure: quota exceeded"))
  assert.ok(isGrokUnknownFlagError("error: unexpected argument '--no-auto-update'"))
  assert.ok(isGrokUnknownFlagError("error: unknown option --tools"))
  assert.ok(!isGrokUnknownFlagError("mock failure: quota exceeded"))
})
