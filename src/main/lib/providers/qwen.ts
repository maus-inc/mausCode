import { execFile } from "node:child_process"
import { type ProviderCapability, TURN_CONTROLS_OFF } from "../../../shared/provider-capabilities"
import { resolveQwenCliLaunch } from "../qwen-binary"
import { probeQwenStoredAuth } from "../qwen-print/auth-config"
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

export function getQwenCapability(): ProviderCapability {
  return {
    id: "qwen",
    displayName: "Qwen",
    kind: "local-cli",
    transport: "qwen (stream-json, one process per turn)",
    license: "Apache-2.0 (QwenLM/qwen-code)",
    billing: "Provider API usage (ModelStudio, DashScope, OpenRouter, ...)",
    security: {
      auth: ["api-key-flags", "cli-config"],
      storesCredentials: true,
      // Turbo runs --approval-mode yolo (no gate); plan/ask/edit/agent
      // keep their approval gates (headless auto-decline, surfaced).
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
      // Parallel tool_use blocks stream as independent calls correlated
      // by toolCallId (same projector posture as the claude backend).
      parallelTools: true,
      contextWindow: null,
      latencyClass: "cloud",
      // stream-json exposes per-turn usage on the wire.
      usageSurface: "native",
    },
    features: {
      chat: true,
      // read_file reads images/PDFs by path; attachments are staged to
      // temp files and referenced from the prompt (cursor posture).
      images: true,
      resume: true,
      // --fork-session exists but is TUI-oriented (no documented
      // headless composition), so it stays unwired (when in doubt, false).
      fork: false,
      mcp: true,
      // agent/task delegation flows through the same tool projector as
      // any other tool call (same posture as the claude backend).
      subagents: true,
      cron: false,
      skills: true,
      structuredOutput: false,
      fileCheckpointing: false,
      ...TURN_CONTROLS_OFF,
    },
    notes: [
      "Images travel as prompt path references the agent reads via tools.",
      "Sessions: client-chosen --session-id UUID on first turns, --resume after.",
      "Plan/ask/edit/agent keep approval gates; turbo runs yolo.",
      "No CLI login command upstream (`qwen auth` was removed): mausCode holds API credentials and injects them per-run via flags.",
    ],
  }
}

/**
 * Fast stored-credential probe (settings + env + .env chain, no network).
 * A stale key reports connected until a turn fails; the router then
 * surfaces auth-error. Held (mausCode-stored) credentials are checked
 * by the router on top of this.
 */
export function probeQwenAuthHome(homeDir?: string): {
  authenticated: boolean
  detail: string
} {
  const probe = probeQwenStoredAuth(homeDir ? { homeDir } : undefined)
  return {
    authenticated: probe.configured,
    detail: probe.detail,
  }
}

export async function probeQwen(): Promise<BackendProbe> {
  let launch: { command: string; args: string[] }
  try {
    launch = resolveQwenCliLaunch(["--version"])
  } catch {
    return { available: false, detail: "qwen CLI binary not found" }
  }
  const version = await runLaunch(launch.command, launch.args)
  if (version.exitCode === null) {
    // Spawn failure (missing/not executable, e.g. a broken $QWEN_BINARY).
    return {
      available: false,
      detail: `qwen binary at ${launch.command} could not be executed`,
    }
  }
  const versionText = `${version.stdout} ${version.stderr}`.trim()
  if (version.exitCode !== 0 || !/qwen/i.test(versionText)) {
    // Not the QwenLM CLI (or too broken to identify).
    return {
      available: false,
      detail:
        `qwen binary at ${launch.command} did not identify as Qwen Code ` +
        "(set $QWEN_BINARY to the QwenLM CLI from https://github.com/QwenLM/qwen-code)",
    }
  }
  const auth = probeQwenAuthHome()
  return {
    available: true,
    version: versionText,
    authenticated: auth.authenticated,
    detail: `binary: ${launch.command}; ${auth.detail}`,
  }
}
