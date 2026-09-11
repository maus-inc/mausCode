import { getClaudeCapability, probeClaude } from "./claude"
import { getHermesCapability, probeHermes } from "./hermes"
import { getCodexCapability, probeCodex } from "./codex"
import { getOpencodeCapability, probeOpencode } from "./opencode"
import { listBackends, registerBackend } from "./registry"
import type { BackendAdapterMeta } from "./types"

registerBackend({
  id: "claude",
  displayName: "Claude",
  getCapability: getClaudeCapability,
  probe: probeClaude,
})

registerBackend({
  id: "hermes",
  displayName: "Hermes",
  getCapability: getHermesCapability,
  probe: probeHermes,
})

registerBackend({
  id: "codex",
  displayName: "Codex",
  getCapability: getCodexCapability,
  probe: probeCodex,
})

registerBackend({
  id: "opencode",
  displayName: "opencode",
  getCapability: getOpencodeCapability,
  probe: probeOpencode,
})

export { listBackends, getBackend } from "./registry"
export type { BackendAdapterMeta, BackendProbe } from "./types"
