/**
 * cursor native-print argv builder tests: mode/flag mapping, stdin
 * overflow, fallback stripping, and retry-error matchers.
 */
import { assert, it } from "@effect/vitest"
import {
  buildCursorPrintArgs,
  buildCursorPrintFallbackArgs,
  CURSOR_STDIN_ONLY_PROMPT_CHARS,
  CURSOR_STDIN_PROMPT_CHARS,
  isCursorInvalidModelError,
  isCursorResumeError,
  isCursorUnknownFlagError,
} from "./args"

it("maps plan/ask to --mode and edit/agent/turbo to force/yolo", () => {
  assert.ok(buildCursorPrintArgs({ mode: "plan", prompt: "hi" }).args.includes("--mode=plan"))
  assert.ok(buildCursorPrintArgs({ mode: "ask", prompt: "hi" }).args.includes("--mode=ask"))
  for (const mode of ["edit", "agent"] as const) {
    const { args } = buildCursorPrintArgs({ mode, prompt: "hi" })
    assert.ok(args.includes("--force"))
    assert.ok(!args.includes("--yolo"))
    assert.ok(!args.some((arg) => arg.startsWith("--mode")))
  }
  const turbo = buildCursorPrintArgs({ mode: "turbo", prompt: "hi" }).args
  assert.ok(turbo.includes("--yolo"))
  assert.ok(!turbo.includes("--force"))
})

it("always passes --trust and threads model/resume through", () => {
  const { args } = buildCursorPrintArgs({
    model: "gpt-5",
    mode: "agent",
    resumeId: "chat-1",
    prompt: "hi",
  })
  assert.ok(args.includes("--trust"))
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), [
    "--model",
    "gpt-5",
  ])
  assert.deepEqual(args.slice(args.indexOf("--resume"), args.indexOf("--resume") + 2), [
    "--resume",
    "chat-1",
  ])
  assert.equal(args[args.length - 1], "hi")
})

it("duplicates mid-size prompts on stdin but keeps argv", () => {
  const prompt = "x".repeat(CURSOR_STDIN_PROMPT_CHARS + 1)
  const { args, stdinText } = buildCursorPrintArgs({
    mode: "agent",
    prompt,
  })
  assert.equal(stdinText, prompt)
  assert.equal(args[args.length - 1], prompt)
})

it("routes huge prompts to stdin only", () => {
  const prompt = "x".repeat(CURSOR_STDIN_ONLY_PROMPT_CHARS + 1)
  const { args, stdinText } = buildCursorPrintArgs({
    mode: "agent",
    prompt,
  })
  assert.equal(stdinText, prompt)
  assert.ok(!args.includes(prompt))
})

it("keeps short prompts on argv", () => {
  const { args, stdinText } = buildCursorPrintArgs({
    mode: "agent",
    prompt: "short",
  })
  assert.equal(stdinText, undefined)
  assert.equal(args[args.length - 1], "short")
})

it("strips newer flags but keeps model/mode/resume on fallback", () => {
  const invocation = buildCursorPrintArgs({
    model: "gpt-5",
    mode: "plan",
    resumeId: "chat-1",
    prompt: "hi",
  })
  const fallback = buildCursorPrintFallbackArgs(invocation)
  for (const dropped of ["--stream-partial-output", "--trust", "--force", "--yolo"]) {
    assert.ok(!fallback.includes(dropped))
  }
  for (const kept of ["--model", "--mode=plan", "--resume", "hi"]) {
    assert.ok(fallback.includes(kept))
  }
})

it("matches resume errors and unknown-flag errors", () => {
  assert.ok(isCursorResumeError("Error: unknown session 'abc'"))
  assert.ok(isCursorResumeError("chat xxx not found"))
  assert.ok(isCursorResumeError("Failed to resume conversation"))
  assert.ok(!isCursorResumeError("mock failure: quota exceeded"))
  assert.ok(isCursorUnknownFlagError("error: unknown flag --trust"))
  assert.ok(isCursorUnknownFlagError("unexpected argument '--yolo'"))
  assert.ok(!isCursorUnknownFlagError("mock failure: quota exceeded"))
  assert.ok(isCursorInvalidModelError("error: unknown model 'foo-9'"))
  assert.ok(isCursorInvalidModelError("model 'bar' not available"))
  assert.ok(!isCursorInvalidModelError("mock failure: quota exceeded"))
})
