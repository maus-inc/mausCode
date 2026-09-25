import { ALL_FEATURES_OFF, type ProviderCapability } from "../../../shared/provider-capabilities"
import { runProbeCommand } from "./probe-command"
import type { BackendProbe } from "./types"

export function getOpencodeCapability(): ProviderCapability {
  return {
    id: "opencode",
    displayName: "opencode",
    kind: "local-cli",
    transport: "opencode serve (local HTTP + SSE)",
    license: "MIT",
    billing: "Bring your own provider keys",
    security: {
      auth: ["provider-keys-cli-managed"],
      storesCredentials: true,
      // Effective posture: the adapter auto-replies; opencode.json can
      // tighten per-tool policy underneath.
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
      mcp: true,
      subagents: true,
    },
    notes: [
      "Permissions auto-reply session-wide; opencode.json can tighten per-tool policy.",
      "Usage (tokens + cost) arrives natively per step; no polling.",
      "Fork (session revert) and structured output are server-possible but unwired.",
      "Chat UI binding (provider selector + transport) is pending; API, probes, and tests are verified.",
    ],
  }
}

export async function probeOpencode(): Promise<BackendProbe> {
  try {
    const version = await runProbeCommand("opencode", ["--version"])
    if (version.exitCode !== 0) {
      return { available: false, detail: "opencode binary not found" }
    }
    const auth = await runProbeCommand("opencode", ["auth", "list"])
    const combined = `${auth.stdout}\n${auth.stderr}`.trim()
    return {
      available: true,
      version: `${version.stdout} ${version.stderr}`.trim(),
      authenticated: auth.exitCode === 0 && combined.length > 0,
      detail: "binary: opencode (PATH)",
    }
  } catch {
    return { available: false, detail: "opencode binary not found" }
  }
}
