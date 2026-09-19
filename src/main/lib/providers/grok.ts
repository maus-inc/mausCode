import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { ProviderCapability } from "../../../shared/provider-capabilities"
import { resolveGrokCliLaunch, resolveGrokHome } from "../grok-binary"
import type { BackendProbe } from "./types"

function runLaunch(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 15000 }, (error, stdout, stderr) => {
      // Spawn failures (ENOENT) carry a string errno, not a numeric code.
      const exitCode = error ? (typeof error.code === "number" ? error.code : null) : 0
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        exitCode,
      })
    })
  })
}

export function getGrokCapability(): ProviderCapability {
  return {
    id: "grok",
    displayName: "Grok",
    kind: "local-cli",
    transport: "grok -p (streaming-json, one process per turn)",
    license: "Proprietary (xAI)",
    billing: "xAI subscription or API usage",
    security: {
      auth: ["grok-login", "api-key-env"],
      storesCredentials: true,
      // Engine-enforced, not app-enforced: headless grok streams output only
      // and gives the app no per-tool callback, so the gate is expressed as
      // argv. acceptEdits auto-approves file edits; everything else needs an
      // --allow rule from the policy file or the CLI refuses it, because
      // there is nobody to ask. The bypass flags are never passed.
      approvals: "configurable",
      sandbox: "none",
      egress: ["provider-configured"],
      retention: "local-session-files",
      requiresHostedService: false,
      permissionFloor: "engine-only",
    },
    performance: {
      streaming: true,
      partialStreaming: true,
      // Concurrent tool_call events stream as independent calls correlated
      // by toolCallId (same projector posture as the cursor backend).
      parallelTools: true,
      contextWindow: null,
      latencyClass: "cloud",
      // streaming-json exposes per-turn usage + spend on the wire.
      usageSurface: "native",
    },
    features: {
      chat: true,
      images: true,
      resume: true,
      // --fork-session exists but its -r composition is undocumented, so it
      // is not wired end-to-end (capability rule: when in doubt, false).
      fork: false,
      mcp: true,
      // Task-tool delegation flows through the same tool projector as any
      // other tool call (same posture as the cursor backend).
      subagents: true,
      cron: false,
      skills: false,
      structuredOutput: false,
      fileCheckpointing: false,
    },
    notes: [
      "Images travel as prompt path references the agent reads via tools.",
      "Sessions: client-chosen -s UUID on first turns, -r to resume.",
      "Plan maps to permission-mode plan and ask to a read-only --tools list; edit/agent/turbo map to acceptEdits plus the policy file's --allow rules.",
      "No `status` subcommand: auth is probed from ~/.grok/auth.json and XAI_API_KEY.",
    ],
  }
}

/**
 * Credential-location probe (there is no `status`/`whoami` subcommand).
 * Positive evidence: a non-empty ~/.grok/auth.json, $XAI_API_KEY, or a
 * per-model api_key in ~/.grok/config.toml. A stale cached token reports
 * connected until a turn fails; the router then surfaces auth-error.
 */
export function probeGrokAuthHome(homeDir?: string): {
  authenticated: boolean
  detail: string
} {
  const home = homeDir ?? resolveGrokHome()
  const hits: string[] = []
  try {
    const authPath = join(home, "auth.json")
    if (existsSync(authPath)) {
      const raw = readFileSync(authPath, "utf8")
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === "string" && parsed.trim().length > 0) {
        hits.push("auth.json")
      }
      const values =
        parsed && typeof parsed === "object" ? Object.values(parsed as Record<string, unknown>) : []
      const hasToken = values.some(
        (value) =>
          (typeof value === "string" && value.trim().length > 0) ||
          (value !== null &&
            typeof value === "object" &&
            Object.values(value as Record<string, unknown>).some(
              (nested) => typeof nested === "string" && nested.trim().length > 0,
            )),
      )
      if (hasToken) hits.push("auth.json")
    }
  } catch {
    // Unreadable credentials count as absent.
  }
  if (process.env.XAI_API_KEY?.trim()) hits.push("XAI_API_KEY")
  try {
    const configPath = join(home, "config.toml")
    if (existsSync(configPath)) {
      const config = readFileSync(configPath, "utf8")
      // Per-model override: [model.<name>] api_key = "..." (documented).
      if (/^\s*api_key\s*=\s*["'][^"']+["']/m.test(config)) {
        hits.push("config.toml model api_key")
      }
    }
  } catch {
    // Ignore config read failures.
  }
  return {
    authenticated: hits.length > 0,
    detail: hits.length > 0 ? `credentials: ${hits.join(", ")}` : "no credentials",
  }
}

export async function probeGrok(): Promise<BackendProbe> {
  let launch: { command: string; args: string[] }
  try {
    launch = resolveGrokCliLaunch(["version"])
  } catch {
    return { available: false, detail: "grok CLI binary not found" }
  }
  const version = await runLaunch(launch.command, launch.args)
  if (version.exitCode === null) {
    // Spawn failure (missing/not executable, e.g. a broken $GROK_BINARY).
    return {
      available: false,
      detail: `grok binary at ${launch.command} could not be executed`,
    }
  }
  if (version.exitCode !== 0) {
    // The generic `grok` name collides with unrelated community CLIs;
    // an official-only subcommand failing is the tell.
    return {
      available: false,
      detail:
        `grok binary at ${launch.command} rejected the official ` +
        "`version` subcommand — likely not the Grok Build CLI " +
        "(set $GROK_BINARY to the official binary from https://docs.x.ai/build/overview)",
    }
  }
  const auth = probeGrokAuthHome()
  return {
    available: true,
    version: `${version.stdout} ${version.stderr}`.trim(),
    authenticated: auth.authenticated,
    detail: `binary: ${launch.command}; ${auth.detail}`,
  }
}
