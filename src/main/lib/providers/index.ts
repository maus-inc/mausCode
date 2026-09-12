import { getClaudeCapability, probeClaude } from "./claude"
import { getClineCapability, probeCline } from "./cline"
import { getCodexCapability, probeCodex } from "./codex"
import { getCursorCapability, probeCursor } from "./cursor"
import { getGrokCapability, probeGrok } from "./grok"
import { getHermesCapability, probeHermes } from "./hermes"
import { getOpenclawCapability, probeOpenclaw } from "./openclaw"
import { getOpencodeCapability, probeOpencode } from "./opencode"
import { getQwenCapability, probeQwen } from "./qwen"
import { registerBackend } from "./registry"
import { getRooCapability, probeRoo } from "./roo"

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
  id: "cursor",
  displayName: "Cursor",
  getCapability: getCursorCapability,
  probe: probeCursor,
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

registerBackend({
  id: "grok",
  displayName: "Grok",
  getCapability: getGrokCapability,
  probe: probeGrok,
})

registerBackend({
  id: "qwen",
  displayName: "Qwen",
  getCapability: getQwenCapability,
  probe: probeQwen,
})

registerBackend({
  id: "cline",
  displayName: "Cline",
  getCapability: getClineCapability,
  probe: probeCline,
})

registerBackend({
  id: "openclaw",
  displayName: "OpenClaw",
  getCapability: getOpenclawCapability,
  probe: probeOpenclaw,
})

registerBackend({
  id: "roo",
  displayName: "Roo Code",
  getCapability: getRooCapability,
  probe: probeRoo,
})

export { getBackend, listBackends } from "./registry"
export type { BackendAdapterMeta, BackendProbe } from "./types"
