import { execFile } from "node:child_process"
import { ALL_FEATURES_OFF, type ProviderCapability } from "../../../shared/provider-capabilities"
import { resolveCursorAgentCliLaunch } from "../cursor-agent-binary"
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

export function getCursorCapability(): ProviderCapability {
  return {
    id: "cursor",
    displayName: "Cursor",
    kind: "local-cli",
    transport: "agent -p (print stream-json, one process per turn)",
    license: "Proprietary (Anysphere)",
    billing: "Cursor plan or API usage",
    security: {
      auth: ["cursor-login", "api-key-env"],
      storesCredentials: true,
      // Print mode runs non-interactively with full write access: no
      // approval gate exists on this path (warns via no-approval-gate).
      approvals: "none",
      sandbox: "none",
      egress: ["provider-configured"],
      retention: "local-session-files",
      requiresHostedService: false,
      permissionFloor: "engine-only",
    },
    performance: {
      streaming: true,
      partialStreaming: true,
      // Headless runs drain delegated subagents and background shells
      // before exiting (CLI changelog), so parallel tool fan-out works.
      parallelTools: true,
      contextWindow: null,
      latencyClass: "cloud",
      usageSurface: "none",
    },
    features: {
      ...ALL_FEATURES_OFF,
      chat: true,
      images: true,
      resume: true,
      mcp: true,
      // Task/subagent delegation drains before print runs exit.
      subagents: true,
    },
    notes: [
      "Images travel as prompt path references the agent reads via tools.",
      "MCP auto-loads from mcp.json every turn (fresh process, no caching).",
      "Plan/ask map to --mode flags; edit/agent pass --force, turbo --yolo.",
      "No token usage is exposed by the print protocol.",
    ],
  }
}

export async function probeCursor(): Promise<BackendProbe> {
  let launch: { command: string; args: string[] }
  try {
    launch = resolveCursorAgentCliLaunch(["--version"])
  } catch {
    return { available: false, detail: "cursor agent binary not found" }
  }
  const version = await runLaunch(launch.command, launch.args)
  if (version.exitCode !== 0) {
    return { available: false, detail: "cursor agent binary not found" }
  }
  // `status` is the documented auth check (displays whether the CLI is
  // authenticated plus account/endpoint info).
  const statusLaunch = resolveCursorAgentCliLaunch(["status"])
  const status = await runLaunch(statusLaunch.command, statusLaunch.args)
  const combined = `${status.stdout}\n${status.stderr}`.toLowerCase()
  const loggedOut =
    combined.includes("not logged in") ||
    combined.includes("not authenticated") ||
    combined.includes("not signed in") ||
    combined.includes("logged out") ||
    combined.includes("signed out") ||
    combined.includes("authentication required")
  const loggedIn =
    combined.includes("logged in") ||
    combined.includes("authenticated") ||
    combined.includes("signed in") ||
    /[\w.+-]+@[\w-]+\.[\w.]+/.test(combined)
  return {
    available: true,
    version: `${version.stdout} ${version.stderr}`.trim(),
    authenticated: status.exitCode === 0 && loggedIn && !loggedOut,
    detail: `binary: ${launch.command}`,
  }
}
