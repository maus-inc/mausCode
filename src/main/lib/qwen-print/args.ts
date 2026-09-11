/**
 * mausCode qwen-print argv builder (ours, NOT verbatim).
 *
 * Native headless turns over `qwen --output-format stream-json`
 * (QwenLM/qwen-code, Apache-2.0; CLI behavior below was verified live
 * against v0.23.3, see qwen-print/README.md):
 *
 * - The prompt is a POSITIONAL arg (`qwen [query..]`); `-p/--prompt` is
 *   deprecated upstream. A prompt starting with `-` cannot ride
 *   positionally (yargs reads it as a flag, and the `--` separator
 *   swallows the positional entirely), so dash-leading prompts use the
 *   `--prompt=<text>` equals form instead (the space form `-p <text>`
 *   misparses the same way).
 * - plan maps to `--approval-mode plan` (read-only; writes auto-denied).
 * - ask maps to `--approval-mode default` + `--exclude-tools` with the
 *   writer/shell/subagent set below (read-only without plan framing;
 *   dispatch denies excluded tools fail-closed).
 * - edit/agent/turbo map to auto-edit/auto/yolo. Headless `default`
 *   auto-DENIES confirmation-requiring tools (no hang, no TTY prompt).
 * - Auth rides per-run flags (`--auth-type`, `--openai-api-key`,
 *   `--openai-base-url`, `-m`) so mausCode-held credentials never touch
 *   the user's ~/.qwen/settings.json. When no held credentials exist the
 *   flags are omitted and the CLI resolves settings/env on its own.
 * - First turns carry a client-chosen `--session-id` UUID (persisted by
 *   the CLI); later turns pass `--resume <id>`.
 */
export type QwenPrintMode = "plan" | "ask" | "edit" | "agent" | "turbo"

export type QwenAuthType =
  | "openai"
  | "openai-responses"
  | "anthropic"
  | "qwen-oauth"
  | "gemini"
  | "vertex-ai"

/**
 * Ask-mode tool denylist (canonical registry names, live-verified):
 * writers (write_file/edit/notebook_edit), shell (run_shell_command and
 * its background watcher monitor), subagents (agent/task), and skills
 * (arbitrary capability bundles). Reads, web tools, todos, memory, and
 * MCP tools stay available. Unknown names are ignored by the CLI, so
 * older builds that lack one of these names still accept the flag.
 */
export const QWEN_ASK_EXCLUDE_TOOLS = [
  "write_file",
  "edit",
  "notebook_edit",
  "run_shell_command",
  "monitor",
  "agent",
  "task",
  "skill",
] as const

export type QwenPrintArgsOptions = {
  /** Full user prompt (images already staged as path references). */
  prompt: string
  mode: QwenPrintMode
  /** Model id for `-m` (verbatim; the CLI does not validate it). */
  model?: string
  /** Held credential auth-type. Omit to let the CLI resolve settings/env. */
  authType?: QwenAuthType
  /** Held API key (openai-family auth only). Never logged. */
  apiKey?: string
  /** Held base URL (openai-family auth only). */
  baseUrl?: string
  /** Resume an existing CLI session. */
  resumeId?: string
  /** Client-chosen id for a fresh CLI session (persisted by the CLI). */
  newSessionId?: string
  /** Extra workspace dirs (`--include-directories`, repeatable). */
  includeDirs?: string[]
  /** `--max-session-turns` cap (positive int; omit = CLI default). */
  maxTurns?: number
  /** `--channel` attribution (default "desktop"). */
  channel?: string
}

export type QwenPrintInvocation = {
  args: string[]
}

const APPROVAL_BY_MODE: Record<QwenPrintMode, string> = {
  plan: "plan",
  // Ask rides `default` (auto-decline) plus the exclude denylist below;
  // plan framing would push the model toward plans instead of answers.
  ask: "default",
  edit: "auto-edit",
  agent: "auto",
  turbo: "yolo",
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function buildQwenPrintArgs(opts: QwenPrintArgsOptions): QwenPrintInvocation {
  const args: string[] = []
  const prompt = opts.prompt

  // Positional prompt first (`qwen [query..]`), except dash-leading
  // prompts which yargs would parse as flags (verified live).
  const dashLeading = prompt.startsWith("-")
  if (!dashLeading) {
    args.push(prompt)
  }

  args.push("--output-format", "stream-json", "--include-partial-messages")
  args.push("--channel", opts.channel || "desktop")

  if (opts.authType) {
    args.push("--auth-type", opts.authType)
  }
  if (isNonEmpty(opts.apiKey)) {
    args.push("--openai-api-key", opts.apiKey.trim())
  }
  if (isNonEmpty(opts.baseUrl)) {
    args.push("--openai-base-url", opts.baseUrl.trim())
  }
  if (isNonEmpty(opts.model)) {
    args.push("-m", opts.model.trim())
  }

  args.push("--approval-mode", APPROVAL_BY_MODE[opts.mode])
  if (opts.mode === "ask") {
    args.push("--exclude-tools", [...QWEN_ASK_EXCLUDE_TOOLS].join(","))
  }

  if (isNonEmpty(opts.resumeId)) {
    args.push("--resume", opts.resumeId.trim())
  } else if (isNonEmpty(opts.newSessionId)) {
    args.push("--session-id", opts.newSessionId.trim())
  }

  for (const dir of opts.includeDirs ?? []) {
    if (isNonEmpty(dir)) {
      args.push("--include-directories", dir.trim())
    }
  }

  if (typeof opts.maxTurns === "number" && Number.isInteger(opts.maxTurns) && opts.maxTurns > 0) {
    args.push("--max-session-turns", String(opts.maxTurns))
  }

  if (dashLeading) {
    // Equals form only: `-p <text>` / `-- <text>` both misparse live.
    args.push(`--prompt=${prompt}`)
  }

  return { args }
}

/**
 * Stable-subset fallback for ancient CLI builds that reject a newer
 * flag (`Unknown argument: ...` on stderr, empty stdout, exit 0).
 * Keeps auth/model/resume (dropping those would convert a flag error
 * into an auth error) and drops channel/partials/excludes/dirs/budgets.
 */
export function buildQwenPrintFallbackArgs(fromArgs: string[]): string[] {
  const keep = new Set([
    "--output-format",
    "--auth-type",
    "--openai-api-key",
    "--openai-base-url",
    "-m",
    "--model",
    "--approval-mode",
    "--resume",
    "--session-id",
  ])
  const out: string[] = []
  let i = 0
  while (i < fromArgs.length) {
    const arg = fromArgs[i]
    if (arg === "--prompt" || arg.startsWith("--prompt=")) {
      // Dash-leading prompt form is load-bearing; always keep.
      if (arg === "--prompt") {
        out.push(arg)
        if (i + 1 < fromArgs.length) {
          out.push(fromArgs[i + 1])
          i += 1
        }
      } else {
        out.push(arg)
      }
      i += 1
      continue
    }
    if (arg.startsWith("--exclude-tools=")) {
      i += 1
      continue
    }
    if (keep.has(arg)) {
      out.push(arg)
      if (i + 1 < fromArgs.length) {
        out.push(fromArgs[i + 1])
        i += 1
      }
      i += 1
      continue
    }
    if (arg.startsWith("-")) {
      // Unknown/newer flag: drop the flag and its value (if any).
      if (
        i + 1 < fromArgs.length &&
        !fromArgs[i + 1].startsWith("-") &&
        // `--flag value` pairs only: bare booleans have no value.
        !isBooleanFlag(arg)
      ) {
        i += 1
      }
      i += 1
      continue
    }
    // Positional prompt (or a kept value already consumed above).
    out.push(arg)
    i += 1
  }
  return out
}

/** Boolean (valueless) flags the fallback drop must not eat past. */
function isBooleanFlag(arg: string): boolean {
  return (
    arg === "--include-partial-messages" ||
    arg === "-y" ||
    arg === "--yolo" ||
    arg === "-d" ||
    arg === "--debug" ||
    arg === "-c" ||
    arg === "--continue" ||
    arg === "--fork-session" ||
    arg === "--safe-mode" ||
    arg === "--bare" ||
    arg === "--include-partial-messages"
  )
}

/** `No saved session found with title "<id>".` (stderr, exit 0). */
export function isQwenResumeError(message: unknown): boolean {
  return typeof message === "string" && /no saved session found/i.test(message)
}

/**
 * Provider-side unknown-model failures (the CLI passes -m through
 * unverified; strict endpoints 404). Conservative phrasing only: a
 * retry with the CLI default model is safe (404s precede tool use).
 */
export function isQwenInvalidModelError(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false
  return (
    /unknown model/i.test(message) ||
    /invalid model/i.test(message) ||
    /model .{0,60}(not found|does not exist)/i.test(message)
  )
}

/** yargs `Unknown argument(s): ...` (stderr, empty stdout, exit 0). */
export function isQwenUnknownFlagError(message: unknown): boolean {
  return typeof message === "string" && /unknown arguments?:/i.test(message)
}

/**
 * Credential failures (in-envelope `error.message` or stderr):
 * no auth-type selected, missing/invalid key, unauthorized. Callers
 * must NOT route permission_denials here (those are policy, not auth).
 */
export function isQwenAuthError(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false
  return (
    /no auth type is selected/i.test(message) ||
    /missing api key for/i.test(message) ||
    /invalid(\s+\w+){0,3}\s+api[- ]?key/i.test(message) ||
    /api[- ]?key.{0,40}(invalid|expired|revoked|incorrect)/i.test(message) ||
    /unauthorized/i.test(message) ||
    /authentication (failed|required|error)/i.test(message) ||
    /\b401\b/.test(message)
  )
}
