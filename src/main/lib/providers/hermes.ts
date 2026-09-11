import { execFile } from "node:child_process"
import type { ProviderCapability } from "../../../shared/provider-capabilities"
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

export function getHermesCapability(): ProviderCapability {
  return {
    id: "hermes",
    displayName: "Hermes",
    kind: "local-cli",
    transport: "hermes acp (ACP stdio) + CLI state subcommands",
    license: "MIT (NousResearch/hermes-agent)",
    billing: "Bring your own provider keys (20+ providers, local included)",
    security: {
      auth: ["provider-keys-cli-managed", "oauth-codex-nous-anthropic"],
      storesCredentials: true,
      // Effective posture: the ACP provider auto-selects the agent's first
      // permission option per request; no mausCode prompt is shown.
      approvals: "session-auto",
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
      usageSurface: "none",
    },
    features: {
      chat: true,
      images: true,
      resume: true,
      fork: false,
      mcp: true,
      subagents: true,
      cron: false,
      skills: true,
      structuredOutput: false,
      fileCheckpointing: false,
    },
    notes: [
      "ACP sessions live in the running server process; resume across restarts is best-effort.",
      "Cron, webhooks, checkpoints, and skills state stay Hermes-owned; read via runCommand, never re-implemented.",
      "Gateway/channels/TUI/Electron app are Hermes surfaces, reported here only.",
      "Configure providers first via `hermes model` (terminal-owned setup).",
      "Chat UI binding (provider selector + transport) is pending; API, probes, and tests are verified.",
    ],
  }
}

export async function probeHermes(): Promise<BackendProbe> {
  const version = await runBinary("hermes", ["--version"])
  if (version.exitCode !== 0) {
    return { available: false, detail: "hermes binary not found" }
  }
  const check = await runBinary("hermes", ["acp", "--check"])
  const auth = await runBinary("hermes", ["auth", "status"])
  return {
    available: true,
    version: `${version.stdout} ${version.stderr}`.trim(),
    authenticated: auth.exitCode === 0,
    detail:
      check.exitCode === 0
        ? "binary: hermes (PATH), ACP ready"
        : "binary: hermes (PATH), ACP extra missing (uv pip install -e '.[acp]')",
  }
}
