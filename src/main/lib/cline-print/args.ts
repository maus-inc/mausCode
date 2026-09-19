/**
 * mausCode cline-print argv builder (ours, NOT verbatim).
 *
 * Headless shape (verified live against cline CLI v3.0.61):
 * `cline -P <provider> -k <key> -m <model> [-p] [-c <cwd>] [-t <s>]
 * --json -- <prompt>`.
 *
 * - `--json` streams NDJSON (hook_event/agent_event/run_result/error).
 * - `--` before the positional is load-bearing: dash-leading prompts
 *   otherwise fail with `unknown option` (live-verified), and `--json`
 *   mode rejects piped-stdin prompts, so stdin carriage is NOT an
 *   option. `--` is passed unconditionally (harmless for normal
 *   prompts, standard commander semantics).
 * - `-P/-k/-m` inject per-run BYOK credentials: mausCode-held keys
 *   never touch `~/.cline/data/settings/providers.json` (which stores
 *   apiKey in PLAINTEXT — observed live via `cline auth`).
 * - NO resume: `--id` is broken in all headless paths in 3.0.61
 *   (fails with "requires a prompt argument" even with a prompt, on
 *   failed AND completed sessions). Multi-turn continuity comes from
 *   transcript-in-prompt (`historyText`, bounded upstream).
 * - Plan/ask map to `-p` (plan mode); edit/agent/turbo run the
 *   default act mode. `--auto-approve` defaults to true upstream and
 *   is left unset (passing false would hang headless runs on
 *   approval prompts).
 */

import type { AgentMode } from "../../../shared/agent-mode"

/** One vocabulary for every provider: the union lives in shared. */
export type ClinePrintMode = AgentMode

export type BuildClinePrintArgsOptions = {
  prompt: string
  mode: ClinePrintMode
  /** Cline provider id for `-P` (e.g. `openrouter`, `anthropic`). */
  provider?: string
  /** Per-run API key for `-k` (omitted for local runtimes). */
  apiKey?: string
  /** Model id for `-m` (omitted = provider default). */
  model?: string
  /** Working directory for `-c` (spawn cwd is set regardless). */
  cwd?: string
  /** Task timeout seconds for `-t` (omitted = no timeout). */
  timeoutSec?: number
  /**
   * Bounded prior-transcript text, wrapped in a
   * `<conversation_history>` block ahead of the prompt. This is the
   * `--id` resume substitute (see header).
   */
  historyText?: string
}

export type ClinePrintArgs = {
  args: string[]
  /** The exact prompt string placed after `--`. */
  promptUsed: string
}

export function buildClinePrintArgs(options: BuildClinePrintArgsOptions): ClinePrintArgs {
  const args: string[] = []

  const provider = options.provider?.trim()
  if (provider) {
    args.push("-P", provider)
  }

  const apiKey = options.apiKey?.trim()
  if (apiKey) {
    args.push("-k", apiKey)
  }

  const model = options.model?.trim()
  if (model) {
    args.push("-m", model)
  }

  if (options.mode === "plan" || options.mode === "ask") {
    args.push("-p")
  }

  const cwd = options.cwd?.trim()
  if (cwd) {
    args.push("-c", cwd)
  }

  if (
    typeof options.timeoutSec === "number" &&
    Number.isFinite(options.timeoutSec) &&
    options.timeoutSec > 0
  ) {
    args.push("-t", String(Math.floor(options.timeoutSec)))
  }

  args.push("--json")

  const history = options.historyText?.trim() ?? ""
  const promptUsed =
    history.length > 0
      ? `<conversation_history>\n${history}\n</conversation_history>\n\n${options.prompt}`
      : options.prompt

  // `--` is unconditional: see the header note on dash-leading prompts.
  args.push("--", promptUsed)

  return { args, promptUsed }
}

const AUTH_ERROR_PATTERNS = [
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
 * Provider auth failures surface as the RAW provider message inside
 * `done{reason:"error"}` / `run_result{finishReason:"error"}` (live:
 * "Incorrect API key provided"). Matches text only — never the key.
 */
export function isClineAuthErrorMessage(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

const INVALID_MODEL_PATTERNS = [
  /model.*?(not found|not available|does not exist|unknown|invalid)/i,
  /(not found|unknown|invalid).*?model/i,
  /model_not_found/i,
  /invalid_model/i,
]

/**
 * Unknown `-m` ids fail the run (provider "model not found" style
 * errors). The router retries once with `-m` dropped (provider
 * default), so id drift degrades to one warning.
 */
export function isClineInvalidModelError(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false
  return INVALID_MODEL_PATTERNS.some((pattern) => pattern.test(message))
}

/** `-t` overruns end as `done{reason:"aborted"}` + "run timed out". */
export function isClineTimeoutMessage(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false
  return /run timed out after/i.test(message) || /timed out/i.test(message)
}
