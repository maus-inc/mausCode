import { execFile } from "node:child_process"
import type { ProviderCapability } from "../../../shared/provider-capabilities"
import { resolveClineCliLaunch } from "../cline-binary"
import { probeClineStoredAuth } from "../cline-print/auth-config"
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

export function getClineCapability(): ProviderCapability {
  return {
    id: "cline",
    displayName: "Cline",
    kind: "local-cli",
    transport: "cline (--json NDJSON, one process per turn)",
    license: "Apache-2.0 (cline/cline)",
    billing: "BYOK provider API usage (OpenRouter, Anthropic, ...) or local runtimes",
    security: {
      auth: ["api-key-flags", "cli-config"],
      storesCredentials: true,
      // Headless runs keep upstream default auto-approval; plan mode
      // (-p) constrains plan/ask turns. No per-turn gate exists.
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
      // Tool calls arrive complete per iteration (no streamed input);
      // iterations with several tools project as correlated pairs.
      parallelTools: true,
      contextWindow: null,
      latencyClass: "cloud",
      // run_result exposes per-turn usage on the wire.
      usageSurface: "native",
    },
    features: {
      chat: true,
      // `@./path.png` image mentions exist upstream, but headless
      // image support is unverified — attachments travel as prompt
      // path references the agent reads via tools (cursor posture).
      images: true,
      // --id resume is broken in all headless paths (v3.0.61):
      // continuity comes from transcript-in-prompt instead.
      resume: false,
      fork: false,
      mcp: true,
      // spawn_agent / team_* tools exist upstream and flow through
      // the tool projector; multi-agent orchestration is CLI-managed.
      subagents: true,
      cron: false,
      skills: true,
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
      "Images travel as prompt path references the agent reads via tools.",
      "No session resume upstream (--id is broken headless): each turn is a fresh session with bounded transcript context.",
      "Plan/ask run -p (plan mode); edit/agent/turbo run act mode with default auto-approval.",
      "mausCode holds one BYOK credential and injects it per-run via -P/-k/-m; CLI config files are never written (providers.json stores keys in plaintext upstream).",
      "The npm wrapper is bypassed (direct binary spawn) so SIGINT-cancel works.",
    ],
  }
}

/**
 * Fast stored-credential probe (providers.json, no network). A stale
 * key reports connected until a turn fails; the router then surfaces
 * auth-error. Held (mausCode-stored) credentials are checked by the
 * router on top of this.
 */
export function probeClineAuthHome(homeDir?: string): {
  authenticated: boolean
  detail: string
} {
  const probe = probeClineStoredAuth(homeDir ? { homeDir } : undefined)
  return {
    authenticated: probe.configured,
    detail: probe.detail,
  }
}

export async function probeCline(): Promise<BackendProbe> {
  let launch: { command: string; args: string[] }
  try {
    launch = resolveClineCliLaunch(["--version"])
  } catch {
    return { available: false, detail: "cline CLI binary not found" }
  }
  const version = await runLaunch(launch.command, launch.args)
  if (version.exitCode === null) {
    // Spawn failure (missing/not executable, e.g. a broken $CLINE_BINARY).
    return {
      available: false,
      detail: `cline binary at ${launch.command} could not be executed`,
    }
  }
  const versionText = `${version.stdout} ${version.stderr}`.trim()
  if (version.exitCode !== 0 || !/^\d+\.\d+\.\d+/.test(versionText)) {
    // Not the cline CLI (it prints a bare semver, e.g. "3.0.61").
    return {
      available: false,
      detail:
        `cline binary at ${launch.command} did not identify as the Cline CLI ` +
        "(set $CLINE_BINARY to the cline CLI from https://docs.cline.bot)",
    }
  }
  const auth = probeClineAuthHome()
  return {
    available: true,
    version: versionText,
    authenticated: auth.authenticated,
    detail: `binary: ${launch.command}; ${auth.detail}`,
  }
}
