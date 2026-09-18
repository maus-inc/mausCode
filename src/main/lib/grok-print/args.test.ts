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
  GROK_TURBO_ALLOW,
  isGrokInvalidModelError,
  isGrokResumeError,
  isGrokUnknownFlagError,
} from "./args"

/**
 * The spellings grok documents as the same bypass. None of them may reach argv
 * in any mode: a bypass the app cannot see defeats the permission gate.
 */
const BYPASS_SPELLINGS = ["--always-approve", "--yolo", "bypassPermissions"]

/** The value that follows `flag`, or undefined when the flag is absent. */
function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}

/** Every value passed to `flag`, in order. */
function flagValues(args: string[], flag: string): string[] {
  return args.flatMap((arg, index) => {
    const value = args[index + 1]
    return arg === flag && value !== undefined ? [value] : []
  })
}

it("maps plan/ask to permission-mode/tools and the writing modes to acceptEdits", () => {
  const plan = buildGrokPrintArgs({ mode: "plan", prompt: "hi" }).args
  assert.equal(flagValue(plan, "--permission-mode"), "plan")

  const ask = buildGrokPrintArgs({ mode: "ask", prompt: "hi" }).args
  assert.equal(flagValue(ask, "--tools"), GROK_ASK_TOOLS)

  for (const mode of ["edit", "agent"] as const) {
    const { args } = buildGrokPrintArgs({ mode, prompt: "hi" })
    assert.equal(flagValue(args, "--permission-mode"), "acceptEdits")
    assert.deepEqual(flagValues(args, "--allow"), [])
  }

  // Turbo is the opt-out tier, so the engine gets rules wide enough to match
  // what the app gate permits there. Without them headless grok fails closed on
  // every shell command and the two providers disagree about what turbo is.
  const turbo = buildGrokPrintArgs({ mode: "turbo", prompt: "hi" }).args
  assert.equal(flagValue(turbo, "--permission-mode"), "acceptEdits")
  assert.deepEqual(flagValues(turbo, "--allow"), [...GROK_TURBO_ALLOW])
})

it("never passes a bypass spelling, with or without an allow-list", () => {
  for (const mode of ["plan", "ask", "edit", "agent", "turbo"] as const) {
    for (const allowTools of [undefined, ["run_terminal_cmd(npm test)"]]) {
      const { args } = buildGrokPrintArgs({ mode, prompt: "hi", allowTools })
      for (const spelling of BYPASS_SPELLINGS) {
        assert.ok(!args.includes(spelling), `${mode} passed ${spelling}`)
      }
    }
  }
})

it("threads the policy allow-list as --allow rules for the writing modes only", () => {
  const allowTools = ["run_terminal_cmd(npm test)", "read_file(*)"]

  // Edit and agent pass only what the policy lists, so neither widens itself by
  // omission.
  for (const mode of ["edit", "agent"] as const) {
    const scoped = buildGrokPrintArgs({ mode, prompt: "hi", allowTools }).args
    assert.deepEqual(flagValues(scoped, "--allow"), allowTools)
  }

  // Turbo starts from the broad list and adds whatever the policy lists.
  const { args } = buildGrokPrintArgs({ mode: "turbo", prompt: "hi", allowTools })
  assert.deepEqual(flagValues(args, "--allow"), [...GROK_TURBO_ALLOW, ...allowTools])

  // Plan and ask take their posture from the CLI, so an allow-list cannot
  // widen either of them from this path.
  for (const mode of ["plan", "ask"] as const) {
    const scoped = buildGrokPrintArgs({ mode, prompt: "hi", allowTools }).args
    assert.deepEqual(flagValues(scoped, "--allow"), [])
  }
})

it("does not put a turbo rule on argv twice", () => {
  const { args } = buildGrokPrintArgs({
    mode: "turbo",
    prompt: "hi",
    allowTools: ["WebFetch", "Bash(git *)"],
  })
  assert.deepEqual(flagValues(args, "--allow"), ["Bash(*)", "WebFetch", "WebSearch", "Bash(git *)"])
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
  const spawned = [invocation.args[0], "/tmp/grok-prompt-1.txt", ...invocation.args.slice(1)]
  const fallback = buildGrokPrintFallbackArgs(spawned, prompt)
  assert.ok(!fallback.includes("--no-auto-update"))
  assert.ok(!fallback.includes("--permission-mode"))
  assert.ok(!fallback.includes("plan"))
  assert.deepEqual(flagValues(fallback, "--allow"), [])
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
    ["-p", "--prompt-file", "--cwd", "/tmp/x", "-m", "grok-4.6"],
    "--prompt-file",
  )
  assert.deepEqual(out, ["-p", "--prompt-file", "--cwd", "/tmp/x", "-m", "grok-4.6"])
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
