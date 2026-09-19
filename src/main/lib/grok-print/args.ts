/**
 * mausCode grok native-print argv builder (pure, unit-tested).
 *
 * Centralizes `grok -p` flag selection so mode/flag mapping stays
 * consistent and reviewable in one place:
 * - plan maps to `--permission-mode plan` (edits rejected outright,
 *   even under always-approve, which are the official plan-mode semantics).
 * - ask maps to a read-only `--tools` allowlist (internal tool IDs
 *   from the headless doc examples: read_file,grep,list_dir plus
 *   web_search,web_fetch). No writers, no shell, no subagents.
 * - edit/agent/turbo map to `--permission-mode acceptEdits` plus
 *   `--allow Tool(pattern)` rules. Edit and agent pass only what the
 *   policy file lists; turbo starts from `GROK_TURBO_ALLOW` (all shell
 *   plus the network tools) so the engine matches what the app gate
 *   permits there. `acceptEdits` is the strongest posture that still
 *   leaves anything unapproved to fail closed: headless grok has no
 *   channel to ask a user, so a tool that is neither an edit nor on the
 *   allow-list errors out instead of running. `--always-approve`, `--yolo` and the
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

/**
 * Turbo's engine allow-list.
 *
 * The app gate permits every class in turbo except exfiltration, so the engine
 * has to be handed rules wide enough to match, otherwise headless grok fails
 * closed on exactly the shell commands turbo is meant to run, and the two
 * providers disagree about what turbo is. This is as close as an engine-only
 * posture gets to unrestricted without passing a bypass token, which step 10's
 * acceptance criteria forbid and `no-bypass.test.ts` asserts absent.
 *
 * `acceptEdits` already covers file edits, so only shell and network are listed.
 * Deny rules win over allow rules in grok, so a policy file can still narrow
 * this. Note what it cannot do: the exfiltration class is "a secret path
 * reaching an egress channel", which is not expressible as a `Tool(pattern)`
 * rule, so grok turbo does not get that protection. Claude turbo does, because
 * the app gate evaluates every call there. `provider-capabilities.ts` records
 * grok as `engine-only` for exactly this reason.
 */
export const GROK_TURBO_ALLOW = ["Bash(*)", "WebFetch", "WebSearch"] as const

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
    for (const rule of allowRulesFor(opts.mode, opts.allowTools)) args.push("--allow", rule)
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
 * Turbo starts from `GROK_TURBO_ALLOW` and adds anything the policy file lists;
 * every other mode passes only what the policy file lists, so a mode cannot
 * widen itself by omission. Duplicates are dropped so a policy entry that
 * repeats a turbo default does not put the same `--allow` on argv twice.
 */
function allowRulesFor(mode: AgentMode, allowTools?: string[]): string[] {
  const fromPolicy = allowTools ?? []
  if (mode !== "turbo") return fromPolicy
  const rules: string[] = [...GROK_TURBO_ALLOW]
  for (const rule of fromPolicy) {
    if (!rules.includes(rule)) rules.push(rule)
  }
  return rules
}

/**
 * Conservative retry argv when the CLI rejects a newer flag (older `grok`
 * builds): `--prompt-file` is rewritten to inline `-p` and `--no-auto-update` is
 * dropped (argv risk accepted for ancient builds).
 *
 * The permission posture is deliberately kept. `--allow` and `--permission-mode`
 * are the whole posture for edit, agent and turbo, `--tools` is the whole posture
 * for ask, and `--permission-mode plan` is the whole posture for plan, because
 * headless grok streams output only and the app gate never sees a tool call
 * there. Stripping them would retry the turn under whatever that build defaults
 * to, which is an agent running with nothing left to refuse a tool. A build that
 * rejects one of them rejects the retry too, so the run then stops with that
 * error rather than executing ungated.
 */
export function buildGrokPrintFallbackArgs(spawnedArgs: string[], prompt: string): string[] {
  const out: string[] = []
  const args = spawnedArgs
  // The prompt sits at index 1 once the builder has inlined it with `-p`, so that
  // word is the user's text and never a flag, whatever it spells. Without this a
  // prompt of "--no-auto-update" was dropped from the retry.
  const promptIndex = args[0] === "-p" ? 1 : -1
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    // Only index 0 can be the prompt flag (builder guarantee): a prompt
    // *text* that happens to equal "--prompt-file" must pass through.
    if (i === 0 && arg === "--prompt-file") {
      out.push("-p", prompt)
      i++ // skip the spliced temp path
      continue
    }
    if (i === promptIndex) {
      out.push(arg)
      continue
    }
    if (arg === "--no-auto-update") continue
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
