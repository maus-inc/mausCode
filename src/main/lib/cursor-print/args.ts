/**
 * mausCode cursor native-print argv builder (pure, unit-tested).
 *
 * Centralizes `agent -p` flag selection so mode/flag mapping stays
 * consistent and reviewable in one place:
 * - plan/ask map to `--mode=plan|ask`; edit/agent/turbo use the default
 *   agent mode (print mode accepts no `--mode=agent` value).
 * - Print runs only *propose* file changes unless approved: edit/agent
 *   pass `--force`, turbo passes `--yolo` (strongest auto-approve).
 * - `--trust` keeps headless runs from pausing on workspace trust.
 * - Long prompts are ALSO piped on stdin (harmless if the CLI ignores
 *   it; `agent -p` stdin support is community-reported, not documented).
 *   The positional prompt is always kept while it fits OS command-line
 *   limits (Windows caps the full command line at ~32KB), so a run can
 *   never silently lose its prompt: past ~30K chars stdin is the only
 *   carrier and a CLI without stdin support fails visibly instead.
 */

export type CursorPrintMode = "plan" | "ask" | "edit" | "agent" | "turbo"

/** Prompts longer than this are additionally piped on stdin. */
export const CURSOR_STDIN_PROMPT_CHARS = 8000

/**
 * Prompts longer than this travel on stdin ONLY: past this size the
 * positional argv copy no longer fits OS command-line limits.
 */
export const CURSOR_STDIN_ONLY_PROMPT_CHARS = 30000

export type CursorPrintInvocation = {
  /** Full argv including `-p` and the prompt (unless stdin-only). */
  args: string[]
  /** Prompt text piped on stdin when it exceeds the argv budget. */
  stdinText?: string
}

export function buildCursorPrintArgs(opts: {
  model?: string
  mode: CursorPrintMode
  resumeId?: string
  prompt: string
}): CursorPrintInvocation {
  const args = ["-p", "--output-format", "stream-json", "--stream-partial-output"]
  if (opts.model) args.push("--model", opts.model)
  if (opts.mode === "plan") args.push("--mode=plan")
  else if (opts.mode === "ask") args.push("--mode=ask")
  else if (opts.mode === "turbo") args.push("--yolo")
  else args.push("--force")
  args.push("--trust")
  if (opts.resumeId) args.push("--resume", opts.resumeId)
  if (opts.prompt.length > CURSOR_STDIN_ONLY_PROMPT_CHARS) {
    return { args, stdinText: opts.prompt }
  }
  if (opts.prompt.length > CURSOR_STDIN_PROMPT_CHARS) {
    return { args: [...args, opts.prompt], stdinText: opts.prompt }
  }
  return { args: [...args, opts.prompt] }
}

/**
 * Conservative retry argv when the CLI rejects a newer flag (older
 * `agent` builds predate `--trust`/`--force`/`--yolo`): keep only the
 * long-stable subset. Model/mode/resume flags are ancient and kept.
 */
export function buildCursorPrintFallbackArgs(invocation: CursorPrintInvocation): string[] {
  const drop = new Set(["--stream-partial-output", "--trust", "--force", "--yolo"])
  return invocation.args.filter((arg) => !drop.has(arg))
}

/** Matches CLI errors for stale/unknown `--resume` chat ids. */
export function isCursorResumeError(message: string): boolean {
  return /resum|unknown session|chat .*not found|invalid.*(session|chat)|no .*session found|session .*not found|session .*expired/i.test(
    message,
  )
}

/** Matches CLI errors for unknown/unavailable `--model` slugs. */
export function isCursorInvalidModelError(message: string): boolean {
  return /unknown model|invalid model|model .*not found|model .*not available|no .*model .*found|unsupported model/i.test(
    message,
  )
}

/** Matches CLI errors for unrecognized flags (older `agent` builds). */
export function isCursorUnknownFlagError(message: string): boolean {
  return /unknown (flag|option|argument)|unrecognized (flag|option|argument)|unexpected argument|invalid option/i.test(
    message,
  )
}
