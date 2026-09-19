/**
 * mausCode roo-print argv builder (ours, NOT verbatim).
 *
 * Headless shape (source-verified against RooCodeInc/Roo-Code
 * apps/cli at cli-v0.1.17; repo archived 2026-05-15, CLI frozen):
 * `roo -p --output-format stream-json -w <dir> --provider <p>
 * -m <model> --mode <mode> --prompt-file <tmp>`.
 *
 * - `-p/--print` is the non-interactive entry point; `--output-format`
 *   is rejected without it (run.ts validates). stream-json emits one
 *   JSON event per stdout line (see session.ts).
 * - Print runs default to NON-interactive auto-approval
 *   (extension-host sets autoApprovalEnabled + alwaysAllow* incl.
 *   MCP/execute/write-outside-workspace when --require-approval is
 *   absent). mausCode never passes -a: approvals posture is
 *   session-auto, matching the sibling backends.
 * - The prompt ALWAYS travels via `--prompt-file` (a per-turn temp
 *   file this builder writes; the router deletes it after the turn
 *   settles): the positional `[prompt]` form would let dash-leading
 *   prompts parse as flags under commander, and argv has platform
 *   length caps the bounded transcript block could exceed.
 * - Auth is ambient + environment: the held key rides in the spawn
 *   env (`ANTHROPIC_API_KEY`, ...) and run.ts resolves it via
 *   getApiKeyFromEnv(provider). The stricter `-k/--api-key` flag is
 *   NOT used: it would expose the key in the process table.
 * - NO resume: `--session-id/--continue` REJECT resume-with-prompt
 *   ("cannot use prompt or --prompt-file with --session-id/--continue",
 *   exit 1), so multi-turn continuity comes from
 *   transcript-in-prompt (`historyText`, bounded upstream).
 * - NO invalid-model retry exists here: unknown `-m` refs do NOT
 *   fail — the extension handler silently falls back to the
 *   provider default (e.g. anthropic.ts getModel()). Model ids are
 *   provider-scoped (see auth-config.ts); listModels only offers ids
 *   valid for the effective provider.
 * - `--ephemeral` is NOT passed: turns persist task sessions under
 *   ~/.vscode-mock/global-storage like a normal CLI run.
 */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentMode } from "../../../shared/agent-mode"

/** One vocabulary for every provider: the union lives in shared. */
export type RooPrintMode = AgentMode

/**
 * mausCode modes -> Roo built-in mode slugs (source: DEFAULT_MODES in
 * @roo-code/types: architect, code, ask, debug, orchestrator).
 * plan maps to architect (design-first), ask stays ask, everything
 * else runs as code (full workspace agency).
 */
export function mapRooMode(mode: RooPrintMode): string {
  switch (mode) {
    case "plan":
      return "architect"
    case "ask":
      return "ask"
    default:
      return "code"
  }
}

export type BuildRooPrintArgsOptions = {
  /** Working directory for `-w` (spawn cwd is set regardless). */
  cwd: string
  /** Effective provider id for `--provider`. */
  provider: string
  /** Model id for `-m` (omitted = upstream default chain). */
  model?: string
  /** mausCode mode, mapped via mapRooMode for `--mode`. */
  mode: RooPrintMode
  /** The user prompt (written to the prompt file, never argv). */
  prompt: string
  /**
   * Bounded prior-transcript text, wrapped in a
   * `<conversation_history>` block ahead of the prompt. This is the
   * resume substitute (see header).
   */
  historyText?: string
}

export type RooPrintArgs = {
  args: string[]
  /** The exact prompt string written to the prompt file. */
  promptUsed: string
  /**
   * Prompt-file path referenced by `--prompt-file`. The caller
   * deletes it after the turn settles (the CLI reads it
   * synchronously at startup, so post-exit deletion is safe).
   */
  promptFile: string
}

/**
 * Write turn-prompt text to a per-turn temp file. Exported for tests;
 * the builder is the normal entry point.
 */
export function writeRooPromptFile(promptText: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mauscode-roo-"))
  const file = join(dir, "prompt.txt")
  writeFileSync(file, promptText, "utf8")
  return file
}

export function buildRooPrintArgs(options: BuildRooPrintArgsOptions): RooPrintArgs {
  const history = options.historyText?.trim() ?? ""
  const promptUsed =
    history.length > 0
      ? `<conversation_history>\n${history}\n</conversation_history>\n\n${options.prompt}`
      : options.prompt
  const promptFile = writeRooPromptFile(promptUsed)

  const args: string[] = ["-p", "--output-format", "stream-json"]

  const cwd = options.cwd?.trim()
  if (cwd) {
    args.push("-w", cwd)
  }

  const provider = options.provider?.trim()
  if (provider) {
    args.push("--provider", provider)
  }

  const model = options.model?.trim()
  if (model) {
    args.push("-m", model)
  }

  args.push("--mode", mapRooMode(options.mode))
  args.push("--prompt-file", promptFile)

  return { args, promptUsed, promptFile }
}

const AUTH_ERROR_PATTERNS = [
  // run.ts pre-run validation (exit 1, "[CLI] Error: ...").
  /no api key provided/i,
  // Provider API failures passthrough (extension ApiHandler errors).
  /incorrect api key/i,
  /invalid[\s_-]*api[\s_-]*key/i,
  /invalid_request.*key/i,
  /\b401\b/,
  /unauthorized/i,
  /forbidden.*key/i,
  /authentication (failed|error|required)/i,
  /api key (is |was )?(missing|invalid|expired|required)/i,
  /expired.*api key/i,
  /sign in/i,
]

/**
 * Auth failures surface as `[CLI] Error: No API key provided...`
 * (missing key, exit 1) or provider API errors mid-turn. Matches
 * text only — never the key.
 */
export function isRooAuthErrorMessage(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}
