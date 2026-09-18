/**
 * mausCode grok native-print argv builder (pure, unit-tested).
 *
 * Centralizes `grok -p` flag selection so mode/flag mapping stays
 * consistent and reviewable in one place:
 * - plan maps to `--permission-mode plan` (edits rejected outright,
 *   even under always-approve — official plan-mode semantics).
 * - ask maps to a read-only `--tools` allowlist (internal tool IDs
 *   from the headless doc examples: read_file,grep,list_dir plus
 *   web_search,web_fetch). No writers, no shell, no subagents.
 * - edit/agent/turbo map to `--permission-mode acceptEdits` plus the
 *   `--allow Tool(pattern)` rules the policy file lists for that mode.
 *   `acceptEdits` is the strongest posture that still leaves anything
 *   unapproved to fail closed: headless grok has no channel to ask a
 *   user, so a tool that is neither an edit nor on the allow-list
 *   errors out instead of running. `--always-approve`, `--yolo` and the
 *   skip-permissions `--permission-mode` value are documented as the same
 *   bypass and are never passed, because a bypass the app cannot see
 *   defeats the gate in `src/main/lib/permissions/`.
 * - `--no-auto-update` on every run (automation requirement) plus
 *   `GROK_DISABLE_AUTOUPDATER=1` in env (belt and suspenders).
 * - Long prompts travel via `--prompt-file` (documented; grok headless
 *   explicitly does NOT read piped stdin into the prompt).
 */

import type { AgentMode } from "../../../shared/agent-mode"

/** Same vocabulary as every other provider: one union, one home. */

export type GrokPrintMode = AgentMode

/** Prompts longer than this travel via --prompt-file instead of argv. */
export const GROK_PROMPT_FILE_CHARS = 8000

/**
 * Read-only internal tool IDs for ask mode (headless-doc sourced).
 * Writers (search_replace), shell (run_terminal_cmd), subagents (task),
 * and MCP invocation (use_tool) are excluded by omission.
 */
export const GROK_ASK_TOOLS = "read_file,grep,list_dir,web_search,web_fetch"

export type GrokPrintInvocation = {
  /** Full argv excluding the binary (starts with `-p` or `--prompt-file`). */
  args: string[]
  /**
   * When set, the caller must write this prompt to a temp file and splice
   * its path into args right after the `--prompt-file` flag (args starts
   * with the flag). Temp-file lifecycle belongs to the session runner
   * (create per turn, delete in `finally`).
   */
  promptFileText?: string
}

export function buildGrokPrintArgs(opts: {
  model?: string
  mode: GrokPrintMode
  resumeId?: string
  /**
   * Client-chosen UUID for a NEW session (`-s`). Pass on first turns so
   * the id is known even if the run is interrupted before `end` (which
   * is the only event carrying the server-side id). Never combined with
   * resumeId (the CLI rejects `-s` with `-r` unless forking).
   */
  newSessionId?: string
  cwd?: string
  prompt: string
  /**
   * `Tool(pattern)` allow rules for edit/agent/turbo, straight from the
   * policy file's `allow_tools` for that mode. Grok reads this syntax
   * natively and deny rules win over allow rules, so the list is passed
   * through untranslated rather than reinvented here.
   */
  allowTools?: string[]
}): GrokPrintInvocation {
  const args = ["--output-format", "streaming-json", "--no-auto-update"]
  if (opts.cwd) args.push("--cwd", opts.cwd)
  if (opts.model) args.push("-m", opts.model)
  if (opts.mode === "plan") args.push("--permission-mode", "plan")
  else if (opts.mode === "ask") args.push("--tools", GROK_ASK_TOOLS)
  else {
    args.push("--permission-mode", "acceptEdits")
    for (const rule of opts.allowTools ?? []) args.push("--allow", rule)
  }
  if (opts.resumeId) args.push("-r", opts.resumeId)
  else if (opts.newSessionId) {
    // The CLI rejects non-UUID -s values; fail fast instead of burning
    // a spawn (router passes crypto.randomUUID()).
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opts.newSessionId)
    ) {
      throw new Error(
        `[grok] newSessionId must be a UUID, got ${JSON.stringify(opts.newSessionId)}`,
      )
    }
    args.push("-s", opts.newSessionId)
  }
  if (opts.prompt.length > GROK_PROMPT_FILE_CHARS) {
    return { args: ["--prompt-file", ...args], promptFileText: opts.prompt }
  }
  return { args: ["-p", opts.prompt, ...args] }
}

/**
 * Conservative retry argv when the CLI rejects a newer flag (older `grok`
 * builds): keep only the long-stable subset. `--prompt-file` is rewritten
 * to inline `-p` (argv risk accepted for ancient builds).
 *
 * `--permission-mode` and `--allow` go together: an old build that rejects one
 * rejects the other, and dropping only the allow rules would leave the retry
 * running under whatever the CLI defaults to.
 */
export function buildGrokPrintFallbackArgs(spawnedArgs: string[], prompt: string): string[] {
  const dropSingle = new Set(["--no-auto-update"])
  const dropPair = new Set(["--permission-mode", "--tools", "--allow"])
  const out: string[] = []
  const args = spawnedArgs
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    // Only index 0 can be the prompt flag (builder guarantee): a prompt
    // *text* that happens to equal "--prompt-file" must pass through.
    if (i === 0 && arg === "--prompt-file") {
      out.push("-p", prompt)
      i++ // skip the spliced temp path
      continue
    }
    if (dropSingle.has(arg)) continue
    if (dropPair.has(arg)) {
      i++ // skip the value too
      continue
    }
    out.push(arg)
  }
  return out
}

/** Matches CLI errors for stale/unknown `-r/--resume` session ids. */
export function isGrokResumeError(message: string | null | undefined): boolean {
  if (!message) return false
  return /\bresum|no .*session found|session .*not found|unknown session|session .*not exist|no session with|invalid.*(session|chat)|session .*expired/i.test(
    message,
  )
}

/** Matches CLI errors for unknown/unavailable `-m/--model` slugs. */
export function isGrokInvalidModelError(message: string | null | undefined): boolean {
  if (!message) return false
  return /unknown model|invalid model|model .*not found|model .*not available|no .*model .*found|unsupported model|model not in/i.test(
    message,
  )
}

/** Matches CLI errors for unrecognized flags (older `grok` builds). */
export function isGrokUnknownFlagError(message: string | null | undefined): boolean {
  if (!message) return false
  return /unknown (flag|option|argument)|unrecognized (flag|option|argument)|unexpected argument|invalid option|unknown argument/i.test(
    message,
  )
}
