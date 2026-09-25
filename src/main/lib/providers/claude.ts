import { existsSync } from "node:fs"
import { eq } from "drizzle-orm"
import { ALL_FEATURES_OFF, type ProviderCapability } from "../../../shared/provider-capabilities"
import { getBundledClaudeBinaryPath } from "../claude/env"
import { getExistingClaudeCredentials } from "../claude-token"
import { anthropicAccounts, anthropicSettings, claudeCodeCredentials, getDatabase } from "../db"
import { runProbeCommand } from "./probe-command"
import type { BackendProbe } from "./types"

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
      // Per-action is a claim about this app, not the SDK: every side-effecting
      // call is routed through the gate in `src/main/lib/permissions/`, and the
      // SDK posture is one that never auto-approves behind that gate. The gate
      // runs at two points on this backend, `canUseTool` and the PreToolUse hook
      // in `src/main/lib/claude/permission-hook.ts`, because the workspace's own
      // `.claude/settings.json` can auto-approve a call that then never reaches
      // `canUseTool`. No other backend has a second point to add.
      approvals: "per-action",
      sandbox: "none",
      egress: ["provider-configured"],
      retention: "local-session-files",
      requiresHostedService: false,
      permissionFloor: "app-gate",
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
      ...ALL_FEATURES_OFF,
      chat: true,
      images: true,
      resume: true,
      fork: true,
      mcp: true,
      subagents: true,
      skills: true,
      // All three on: the 0.3.270 pin carries `Options.effort`, adaptive
      // thinking and `Options.promptSuggestions` through a turn end to end.
      effort: true,
      adaptiveThinking: true,
      promptSuggestions: true,
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
    const version = await runProbeCommand(binary, ["--version"])
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
