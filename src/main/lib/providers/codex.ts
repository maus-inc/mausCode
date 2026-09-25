import { join } from "node:path"
import { app } from "electron"
import { ALL_FEATURES_OFF, type ProviderCapability } from "../../../shared/provider-capabilities"
import { runProbeCommand } from "./probe-command"
import type { BackendProbe } from "./types"

function resolveCodexBinary(): string {
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex"
  if (app.isPackaged) {
    return join(process.resourcesPath, "bin", binaryName)
  }
  return join(
    app.getAppPath(),
    "resources",
    "bin",
    `${process.platform}-${process.arch}`,
    binaryName,
  )
}

export function getCodexCapability(): ProviderCapability {
  return {
    id: "codex",
    displayName: "Codex",
    kind: "local-cli",
    transport: "codex app-server (JSON-RPC stdio)",
    license: "Apache-2.0 (CLI)",
    billing: "ChatGPT plan or API usage",
    security: {
      auth: ["oauth-chatgpt", "api-key-env"],
      storesCredentials: true,
      approvals: "session-auto",
      sandbox: "workspace-write",
      egress: ["provider-configured"],
      retention: "local-session-files",
      requiresHostedService: false,
      permissionFloor: "engine-only",
    },
    performance: {
      streaming: true,
      partialStreaming: true,
      parallelTools: true,
      contextWindow: null,
      latencyClass: "cloud",
      usageSurface: "session-files",
    },
    features: {
      ...ALL_FEATURES_OFF,
      chat: true,
      images: true,
      resume: true,
      mcp: true,
      // The app-server takes a reasoning effort on a turn; Codex chooses its
      // own thinking budget and sends no prompt suggestion.
      effort: true,
    },
    notes: [
      "Approvals auto-grant session-wide (parity with the former ACP path).",
      "Usage is polled from local codex session files.",
      "Subagents/skills stay off until verified against the pinned CLI.",
    ],
  }
}

export async function probeCodex(): Promise<BackendProbe> {
  const candidates = [resolveCodexBinary(), "codex"]
  for (const binary of candidates) {
    try {
      const version = await runProbeCommand(binary, ["--version"])
      if (version.exitCode === 0) {
        const login = await runProbeCommand(binary, ["login", "status"])
        const combined = `${login.stdout}\n${login.stderr}`.toLowerCase()
        return {
          available: true,
          version: `${version.stdout} ${version.stderr}`.trim(),
          authenticated:
            login.exitCode === 0 &&
            (combined.includes("logged in") ||
              combined.includes("authenticated") ||
              combined.includes("api key")),
          detail: `binary: ${binary}`,
        }
      }
    } catch {
      // Try the next candidate.
    }
  }
  return { available: false, detail: "codex binary not found" }
}
