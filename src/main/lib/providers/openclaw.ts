import { ALL_FEATURES_OFF, type ProviderCapability } from "../../../shared/provider-capabilities"
import { resolveOpenclawCliLaunch } from "../openclaw-binary"
import { readOpenclawModelsStatus, summarizeModelsStatusAuth } from "../openclaw-print/auth-config"
import { runProbeCommand } from "./probe-command"
import type { BackendProbe } from "./types"

/** This manifest's launch probe has always been given twice the shared bound. */
const LAUNCH_PROBE_TIMEOUT_MS = 30_000

export function getOpenclawCapability(): ProviderCapability {
  return {
    id: "openclaw",
    displayName: "OpenClaw",
    kind: "local-cli",
    transport: "openclaw agent exec (JSON envelope, one process per turn)",
    license: "MIT (openclaw/openclaw)",
    billing: "BYOK provider API usage (OpenAI, Anthropic, OpenRouter, xAI)",
    security: {
      auth: ["api-key-env", "cli-config"],
      storesCredentials: true,
      // Headless exec runs the full execution policy without
      // interactive prompts; plan/ask turns carry a read-only
      // planning prefix instead. No per-turn gate exists.
      approvals: "session-auto",
      sandbox: "none",
      egress: ["provider-configured"],
      retention: "local-session-files",
      requiresHostedService: false,
      permissionFloor: "engine-only",
    },
    performance: {
      // Exec prints ONE envelope at settle time: no streaming
      // surface exists (long turns emit nothing until done).
      streaming: false,
      partialStreaming: false,
      // The envelope reports tool counts only; parallel-tool
      // behavior is unverified.
      parallelTools: false,
      contextWindow: null,
      latencyClass: "cloud",
      // The envelope exposes per-turn usage + USD cost.
      usageSurface: "native",
    },
    features: {
      ...ALL_FEATURES_OFF,
      chat: true,
      // No image input surface on exec — attachments travel as prompt
      // path references the agent reads via tools (cline posture).
      images: true,
      // Exec accepts no session id: each turn is a fresh session with
      // bounded transcript context.
      resume: false,
      mcp: true,
      // Upstream skills exist but exec-run skill loading is
      // unverified from here.
      skills: false,
    },
    notes: [
      "One JSON envelope per turn — no streaming; progress appears only when the turn settles.",
      "Images travel as prompt path references the agent reads via tools.",
      "No session resume upstream (exec takes no session id): each turn is a fresh session with bounded transcript context.",
      "Plan/ask run with a read-only planning prefix (no plan-mode flag exists); edit/agent/turbo run unconstrained.",
      "mausCode holds one BYOK credential and injects it per-run via the spawn environment; CLI config files are never written (onboarding stores keys in plaintext by default).",
    ],
  }
}

/**
 * Ambient-auth probe via `models status --json` (side-effect-free,
 * ~2s, honors $HOME). A stale key reports connected until a turn
 * fails; the router then surfaces auth-error. Held
 * (mausCode-stored) credentials are checked by the router on top of
 * this.
 */
export async function probeOpenclawAuthHome(homeDir?: string): Promise<{
  authenticated: boolean
  detail: string
}> {
  try {
    const launch = resolveOpenclawCliLaunch()
    const status = await readOpenclawModelsStatus(
      {
        command: launch.command,
        args: launch.args,
        ...(homeDir ? { env: { HOME: homeDir } } : {}),
      },
      { timeoutMs: 30_000 },
    )
    const summary = summarizeModelsStatusAuth(status)
    return {
      authenticated: summary.configured,
      detail: summary.detail,
    }
  } catch {
    return {
      authenticated: false,
      detail: "Could not read OpenClaw model status.",
    }
  }
}

/**
 * Binary-only probe (`--version`, ~2s). The router checks this first
 * and only runs the ambient-auth probe when no held credential
 * exists — bundling both here would waste a `models status` spawn on
 * every held-credential integration check.
 */
export async function probeOpenclawBinary(): Promise<{
  available: boolean
  version?: string
  detail: string
}> {
  let launch: { command: string; args: string[] }
  try {
    launch = resolveOpenclawCliLaunch(["--version"])
  } catch {
    return { available: false, detail: "openclaw CLI binary not found" }
  }
  const version = await runProbeCommand(launch.command, launch.args, LAUNCH_PROBE_TIMEOUT_MS)
  if (version.exitCode === null) {
    // Spawn failure (missing/not executable, e.g. a broken $OPENCLAW_BINARY).
    return {
      available: false,
      detail: `openclaw binary at ${launch.command} could not be executed`,
    }
  }
  // The CLI prints e.g. "OpenClaw 2026.9.2 (3928bad)".
  const versionText = `${version.stdout} ${version.stderr}`.trim()
  const match = /OpenClaw\s+([\d][\d.]*)/.exec(versionText)
  if (version.exitCode !== 0 || !match) {
    return {
      available: false,
      detail:
        `openclaw binary at ${launch.command} did not identify as the OpenClaw CLI ` +
        "(set $OPENCLAW_BINARY to the openclaw CLI from https://docs.openclaw.ai)",
    }
  }
  return {
    available: true,
    version: match[1],
    detail: `binary: ${launch.command}`,
  }
}

export async function probeOpenclaw(): Promise<BackendProbe> {
  const binary = await probeOpenclawBinary()
  if (!binary.available) {
    return { available: false, detail: binary.detail }
  }
  const auth = await probeOpenclawAuthHome()
  return {
    available: true,
    version: binary.version,
    authenticated: auth.authenticated,
    detail: `${binary.detail}; ${auth.detail}`,
  }
}
