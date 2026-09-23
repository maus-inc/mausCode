import { execFile } from "node:child_process"
import { join } from "node:path"
import { app } from "electron"
import { type ProviderCapability, TURN_CONTROLS_OFF } from "../../../shared/provider-capabilities"
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

function runBinary(
  binary: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: 15000 }, (error, stdout, stderr) => {
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
      chat: true,
      images: true,
      resume: true,
      fork: false,
      mcp: true,
      subagents: false,
      cron: false,
      skills: false,
      structuredOutput: false,
      fileCheckpointing: false,
      ...TURN_CONTROLS_OFF,
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
      const version = await runBinary(binary, ["--version"])
      if (version.exitCode === 0) {
        const login = await runBinary(binary, ["login", "status"])
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
