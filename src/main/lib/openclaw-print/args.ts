/**
 * mausCode openclaw-print argv builder (ours, NOT verbatim).
 *
 * Headless shape (verified live against openclaw CLI 2026.9.2):
 * `openclaw agent exec --json --timeout <s> --cwd <dir>
 * [--model <provider/model>] --message-file -` + prompt on stdin.
 *
 * - `agent exec` is the documented headless entry point: one embedded
 *   agent turn, no Gateway connection, owns setup/cleanup/status.
 * - `--json` reserves stdout for ONE stable envelope object (`ok`,
 *   `status`, `final`, `payloads`, `usage`, `model`, `provider`,
 *   `sessionId`, ...), printed when the turn settles. There is NO
 *   streaming surface: diagnostics go to stderr instead.
 * - The prompt travels via stdin (`--message-file -`, live-verified)
 *   so dash-leading prompts can never parse as flags.
 * - Auth is ambient + environment: the held key is placed in the
 *   spawn env (`OPENAI_API_KEY`, ...) and the run inherits the
 *   operator config (MCP servers, skills, harness selection). The
 *   stricter `--auth-env-only` / `--isolated` modes are NOT used:
 *   they load no config at all, which would drop the user's MCP
 *   servers from the turn (live-verified env detection instead).
 * - NO resume: `agent exec` accepts no session id (the returned
 *   `sessionId` is debugging-only). Multi-turn continuity comes from
 *   transcript-in-prompt (`historyText`, bounded upstream).
 * - NO mode flag exists: plan/ask turns carry a read-only planning
 *   prefix in the prompt (built by the router, not here).
 */

export type OpenclawPrintMode = "plan" | "ask" | "edit" | "agent" | "turbo"

export type BuildOpenclawPrintArgsOptions = {
  /** Working directory for `--cwd` (spawn cwd is set regardless). */
  cwd: string
  /** Qualified model ref for `--model` (omitted = config default). */
  model?: string
  /** Agent deadline seconds for `--timeout` (default 600 upstream). */
  timeoutSec?: number
  /**
   * Bounded prior-transcript text, wrapped in a
   * `<conversation_history>` block ahead of the prompt. This is the
   * resume substitute (see header).
   */
  historyText?: string
  /** The user prompt. Travels on stdin, never argv. */
  prompt: string
}

export type OpenclawPrintArgs = {
  args: string[]
  /** The exact prompt string written to stdin. */
  promptUsed: string
}

export const OPENCLAW_DEFAULT_TIMEOUT_SEC = 600

export function buildOpenclawPrintArgs(options: BuildOpenclawPrintArgsOptions): OpenclawPrintArgs {
  const args: string[] = ["agent", "exec", "--json"]

  const timeout =
    typeof options.timeoutSec === "number" &&
    Number.isFinite(options.timeoutSec) &&
    options.timeoutSec > 0
      ? Math.floor(options.timeoutSec)
      : OPENCLAW_DEFAULT_TIMEOUT_SEC
  args.push("--timeout", String(timeout))

  const cwd = options.cwd?.trim()
  if (cwd) {
    args.push("--cwd", cwd)
  }

  const model = options.model?.trim()
  if (model) {
    args.push("--model", model)
  }

  // Stdin carriage: `--message-file -` reads the prompt from stdin.
  args.push("--message-file", "-")

  const history = options.historyText?.trim() ?? ""
  const promptUsed =
    history.length > 0
      ? `<conversation_history>\n${history}\n</conversation_history>\n\n${options.prompt}`
      : options.prompt

  return { args, promptUsed }
}

const AUTH_ERROR_PATTERNS = [
  // Live: missing credentials for the routed provider.
  /no route-compatible authentication source/i,
  /missing auth/i,
  /no api key found/i,
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
 * Auth failures surface as the envelope `error.message` (live:
 * "No route-compatible authentication source is configured for
 * openai."). Matches text only — never the key.
 */
export function isOpenclawAuthErrorMessage(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * Unknown `--model` refs fail the run as `Unknown model: <ref>`
 * (live-verified). The router retries once with `--model` dropped
 * (config default) when the held provider is openai-shaped or no
 * held credential exists; other held providers keep the error.
 */
export function isOpenclawInvalidModelError(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false
  return /unknown model\s*:/i.test(message)
}

/** Timeout envelopes carry `status: "timeout"` (live, exit 2). */
export function isOpenclawTimeoutStatus(status: unknown): boolean {
  return status === "timeout"
}
