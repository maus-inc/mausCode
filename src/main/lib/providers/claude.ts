import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import type { ProviderCapability } from "../../../shared/provider-capabilities"
import { getBundledClaudeBinaryPath } from "../claude/env"
import { getExistingClaudeCredentials } from "../claude-token"
import {
  anthropicAccounts,
  anthropicSettings,
  claudeCodeCredentials,
  getDatabase,
} from "../db"
import { eq } from "drizzle-orm"
import type { BackendProbe } from "./types"

function runBinary(
  binary: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: 15000 }, (error, stdout, stderr) => {
      // Spawn failures (ENOENT) carry a string errno, not a numeric code.
      const exitCode = error
        ? typeof error.code === "number"
          ? error.code
          : null
        : 0
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        exitCode,
      })
    })
  })
}

/**
 * Local-only credential presence (no decrypt, no network): env API key,
 * app DB tokens (multi-account + legacy), or CLI-managed local credentials.
 */
function hasLocalCredentials(): boolean {
  try {
    if (process.env.ANTHROPIC_API_KEY?.trim()) return true
    if (getExistingClaudeCredentials()) return true
    const db = getDatabase()
    const settings = db
      .select()
      .from(anthropicSettings)
      .where(eq(anthropicSettings.id, "singleton"))
      .get()
    if (settings?.activeAccountId) {
      const account = db
        .select()
        .from(anthropicAccounts)
        .where(eq(anthropicAccounts.id, settings.activeAccountId))
        .get()
      if (account?.oauthToken) return true
    }
    const legacy = db
      .select()
      .from(claudeCodeCredentials)
      .where(eq(claudeCodeCredentials.id, "default"))
      .get()
    return !!legacy?.oauthToken
  } catch {
    return false
  }
}

export function getClaudeCapability(): ProviderCapability {
  return {
    id: "claude",
    displayName: "Claude",
    kind: "local-sdk",
    transport: "claude-agent-sdk (spawns claude CLI)",
    license: "Anthropic commercial (code.claude.com legal)",
    billing: "Claude Pro/Max OAuth or API usage",
    security: {
      auth: ["oauth-claude", "api-key-env", "cli-credentials"],
      storesCredentials: true,
      approvals: "per-action",
      sandbox: "none",
      egress: ["provider-configured"],
      retention: "local-session-files",
      requiresHostedService: false,
    },
    performance: {
      streaming: true,
      partialStreaming: true,
      parallelTools: true,
      contextWindow: null,
      latencyClass: "cloud",
      usageSurface: "native",
    },
    features: {
      chat: true,
      images: true,
      resume: true,
      fork: true,
      mcp: true,
      subagents: true,
      cron: false,
      skills: true,
      structuredOutput: false,
      fileCheckpointing: false,
    },
    notes: [
      "Per-action approvals via canUseTool + in-chat approval prompts.",
      "Usage + cost arrive natively on result messages.",
      "History is never replayed on resume; mausCode persists its own copy.",
    ],
  }
}

export async function probeClaude(): Promise<BackendProbe> {
  const candidates = [getBundledClaudeBinaryPath(), "claude"].filter(
    (binary, index) => index > 0 || existsSync(binary),
  )
  for (const binary of candidates) {
    const version = await runBinary(binary, ["--version"])
    if (version.exitCode === 0) {
      return {
        available: true,
        version: `${version.stdout} ${version.stderr}`.trim(),
        authenticated: hasLocalCredentials(),
        detail: `binary: ${binary}`,
      }
    }
  }
  return { available: false, detail: "claude binary not found" }
}
