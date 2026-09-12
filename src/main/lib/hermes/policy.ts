/**
 * hermes-agent pure policy helpers (node-safe, electron-free): the
 * read-only subcommand allowlist and the error/auth classifier. Imported by
 * the hermes router and its tests.
 */

const AUTH_HINTS = [
  "401",
  "403",
  "unauthorized",
  "unauthenticated",
  "invalid api key",
  "incorrect api key",
  "api key",
  "forbidden",
  "login",
  "auth",
  "token",
  "oauth",
  "quota",
  "billing",
  "payment",
  "no credentials",
  "missing credentials",
  "not configured",
]

/**
 * Read-only hermes subcommands exposed via runCommand (top-level names from
 * the upstream CLI reference). Everything state-changing (chat, send,
 * gateway, login flows, update, import, backup, exec-style tools) stays out.
 */
const READONLY_COMMANDS = new Set([
  "status",
  "cron",
  "skills",
  "mcp",
  "webhook",
  "tools",
  "memory",
  "checkpoints",
  "auth",
  "config",
  "plugins",
  "approvals",
  "doctor",
  "logs",
  "prompt-size",
  "project",
  "hooks",
  "lsp",
  "journey",
  "bundles",
  "curator",
  "model",
  "moa",
  "fallback",
  "peer",
  "kanban",
  "portal",
])

export function isHermesReadonlyCommand(command: string): boolean {
  return READONLY_COMMANDS.has(command.trim())
}

export function extractHermesError(error: unknown): {
  message: string
  code?: string
} {
  const err =
    typeof error === "object" && error !== null
      ? (error as {
          data?: { message?: unknown; code?: unknown }
          errorText?: unknown
          message?: unknown
          error?: unknown
          code?: unknown
        })
      : null

  const message =
    err?.data?.message || err?.errorText || err?.message || err?.error || String(error)
  const code = err?.data?.code || err?.code

  return {
    message: typeof message === "string" ? message : String(message),
    code: typeof code === "string" ? code : undefined,
  }
}

export function isHermesAuthError(params: {
  message?: string | null
  code?: string | null
}): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`.toLowerCase()
  return AUTH_HINTS.some((hint) => searchableText.includes(hint))
}
