import { execFile } from "node:child_process"
import type { ProviderCapability } from "../../../shared/provider-capabilities"
import { getClaudeShellEnvironment } from "../claude/env"
import { resolveRooCliLaunch } from "../roo-binary"
import { resolveRooAmbientAuth } from "../roo-print/auth-config"
import type { BackendProbe } from "./types"

function runLaunch(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 30000 }, (error, stdout, stderr) => {
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

export function getRooCapability(): ProviderCapability {
  return {
    id: "roo",
    displayName: "Roo Code",
    kind: "local-cli",
    transport: "roo -p (stream-json NDJSON, one process per turn)",
    license: "Apache-2.0 (RooCodeInc/Roo-Code, archived 2026-05-15)",
    billing: "BYOK provider API usage (Anthropic, OpenAI, Gemini, OpenRouter, Vercel AI Gateway)",
    security: {
      auth: ["api-key-env", "cli-config"],
      storesCredentials: true,
      // Headless print runs the full auto-approval policy without
      // interactive prompts; mausCode modes map to Roo mode slugs
      // (plan->architect, ask->ask, else code). No per-turn gate.
      approvals: "session-auto",
      sandbox: "none",
      egress: ["provider-configured"],
      retention: "local-session-files",
      requiresHostedService: false,
      permissionFloor: "engine-only",
    },
    performance: {
      streaming: true,
      partialStreaming: true,
      parallelTools: false,
      contextWindow: null,
      latencyClass: "cloud",
      // The result event reports per-turn usage + USD cost.
      usageSurface: "native",
    },
    features: {
      chat: true,
      // No image input surface on print — attachments travel as prompt
      // path references the agent reads via tools (cline posture).
      images: true,
      // Resume rejects prompt upstream: each turn is a fresh session
      // with bounded transcript context.
      resume: false,
      fork: false,
      mcp: true,
      subagents: false,
      cron: false,
      // Upstream custom tools exist but print-run skill loading is
      // unverified from here.
      skills: false,
      structuredOutput: false,
      fileCheckpointing: false,
      // True only where a turn can actually carry the value end to end; the
      // evidence per backend is in
      // `.dump/app/research/2026-09-13-sdk-0-3-bump.md`.
      effort: false,
      adaptiveThinking: false,
      promptSuggestions: false,
    },
    notes: [
      "Streams NDJSON events per turn (text deltas, thinking, tool calls, command output, cost).",
      "Images travel as prompt path references the agent reads via tools.",
      "No session resume upstream (resume rejects prompt): each turn is a fresh session with bounded transcript context.",
      "Modes map to Roo slugs (plan->architect, ask->ask, edit/agent/turbo->code); print runs auto-approve.",
      "mausCode holds one BYOK credential and injects it per-run via the spawn environment; CLI config files are never written.",
      "Model ids are provider-scoped: unknown ids silently fall back to the provider default upstream, so only verified ids are offered.",
    ],
  }
}

/**
 * Ambient-auth probe: pure file+env read, no spawn. The effective
 * provider comes from ~/.roo/cli-settings.json (default openrouter)
 * and auth counts as present when that provider's env variable is
 * set. A stale key reports connected until a turn fails; the router
 * then surfaces auth-error. Held (mausCode-stored) credentials are
 * checked by the router on top of this.
 */
export async function probeRooAuthHome(homeDir?: string): Promise<{
  authenticated: boolean
  detail: string
}> {
  try {
    // GUI-spawned apps miss shell dotfile exports: merge the login
    // shell environment so ambient keys resolve like a terminal run.
    let shellEnv: Record<string, string> = {}
    try {
      shellEnv = getClaudeShellEnvironment()
    } catch {
      // process.env was already the fallback below.
    }
    const auth = resolveRooAmbientAuth({
      ...(homeDir ? { homeDir } : {}),
      env: { ...process.env, ...shellEnv },
    })
    return { authenticated: auth.configured, detail: auth.detail }
  } catch {
    return {
      authenticated: false,
      detail: "Could not read Roo ambient auth.",
    }
  }
}

/**
 * Binary-only probe (`--version`, ~2s). The router checks this first
 * and only runs the ambient-auth probe when no held credential
 * exists. The CLI prints the bare package version (e.g. 0.1.17).
 */
export async function probeRooBinary(): Promise<{
  available: boolean
  version?: string
  detail: string
}> {
  let launch: { command: string; args: string[] }
  try {
    launch = resolveRooCliLaunch(["--version"])
  } catch {
    return { available: false, detail: "roo CLI binary not found" }
  }
  const version = await runLaunch(launch.command, launch.args)
  if (version.exitCode === null) {
    // Spawn failure (missing/not executable, e.g. a broken $ROO_BINARY).
    return {
      available: false,
      detail: `roo binary at ${launch.command} could not be executed`,
    }
  }
  const versionText = `${version.stdout} ${version.stderr}`.trim()
  const match = /(\d+\.\d+\.\d+)/.exec(versionText)
  if (version.exitCode !== 0 || !match) {
    return {
      available: false,
      detail:
        `roo binary at ${launch.command} did not identify as the Roo Code CLI ` +
        "(set $ROO_BINARY to the roo CLI from https://github.com/RooCodeInc/Roo-Code)",
    }
  }
  return {
    available: true,
    version: match[1],
    detail: `binary: ${launch.command}`,
  }
}

export async function probeRoo(): Promise<BackendProbe> {
  const binary = await probeRooBinary()
  if (!binary.available) {
    return { available: false, detail: binary.detail }
  }
  const auth = await probeRooAuthHome()
  return {
    available: true,
    version: binary.version,
    authenticated: auth.authenticated,
    detail: `${binary.detail}; ${auth.detail}`,
  }
}
