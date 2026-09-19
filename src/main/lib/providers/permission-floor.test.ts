/**
 * Two vocabularies state one fact, and a tooltip is built from the second.
 *
 * The manifests in this directory declare `permissionFloor` per backend id, and
 * the chat UI holds sub-chat provider ids, which are not the same strings: the
 * backend `claude` is the binding `claude-code`, and `gemini` and `openrouter`
 * are bindings no manifest carries at all. `permissionFloorFor` is what a mode
 * tooltip reads, so the two have to agree or a user is told two different things
 * about one backend.
 *
 * This reads the manifests as source text rather than importing them, because
 * importing a provider reaches electron through `src/main/lib/claude/env.ts` and
 * vitest here is node-only by design. `src/main/lib/permissions/no-bypass.test.ts`
 * guards its criterion the same way.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { permissionFloorFor } from "../../../shared/provider-capabilities"
import { SUB_CHAT_PROVIDERS } from "../../../shared/sub-chat-provider"

const PROVIDERS_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * The sub-chat binding each backend serves. A backend with no entry here cannot
 * be selected in a chat, so no mode picker reports a floor for it.
 */
const PROVIDER_FOR_BACKEND: Record<string, string> = {
  claude: "claude-code",
  cline: "cline",
  codex: "codex",
  cursor: "cursor",
  grok: "grok",
  openclaw: "openclaw",
  qwen: "qwen",
  roo: "roo",
}

/** Backends a chat cannot be bound to. */
const WITHOUT_SUB_CHAT_BINDING = ["hermes", "opencode"]

type DeclaredFloor = { id: string; floor: string | undefined }

/** Every manifest in this directory, by the id it declares for itself. */
function declaredFloors(): DeclaredFloor[] {
  const found: DeclaredFloor[] = []
  for (const entry of readdirSync(PROVIDERS_ROOT)) {
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue
    const id = entry.slice(0, -".ts".length)
    const text = readFileSync(join(PROVIDERS_ROOT, entry), "utf-8")
    // Model tables and the registry declare ids of their own, so a manifest is
    // the file that names itself as one.
    if (!text.includes(`id: "${id}"`)) continue
    const floor = /permissionFloor: "(app-gate|engine-only)"/.exec(text)?.[1]
    found.push({ id, floor })
  }
  return found
}

describe("permissionFloorFor", () => {
  it("agrees with the manifest of every backend a chat can select", () => {
    const checked: string[] = []
    for (const declared of declaredFloors()) {
      const provider = PROVIDER_FOR_BACKEND[declared.id]
      if (provider === undefined) continue
      expect(permissionFloorFor(provider), declared.id).toBe(declared.floor)
      checked.push(declared.id)
    }
    // An empty walk would satisfy the loop above without comparing anything.
    expect(checked.sort()).toEqual(Object.keys(PROVIDER_FOR_BACKEND).sort())
  })

  it("reads a floor out of every manifest it ships", () => {
    const ids = declaredFloors()
      .map((declared) => declared.id)
      .sort()
    // A new backend has to land in one of the two tables, so the floor behind its
    // modes is a decision somebody made rather than a default it inherited.
    expect(ids).toEqual([...Object.keys(PROVIDER_FOR_BACKEND), ...WITHOUT_SUB_CHAT_BINDING].sort())
    for (const declared of declaredFloors()) {
      expect(declared.floor, declared.id).toBeDefined()
    }
  })

  it("gives an app gate only to the backend whose tool calls reach the evaluator", () => {
    // `evaluateAction` is called from the Claude permission hook and the Claude
    // router's canUseTool, and from nowhere else, so no other manifest can claim
    // a gate and no other binding can be told it has one.
    const gated = declaredFloors()
      .filter((declared) => declared.floor === "app-gate")
      .map((declared) => declared.id)
    expect(gated).toEqual(["claude"])
    expect(permissionFloorFor("claude-code")).toBe("app-gate")
  })

  it("names a floor for every binding a chat can hold", () => {
    for (const provider of SUB_CHAT_PROVIDERS) {
      const floor = permissionFloorFor(provider)
      expect(floor === "app-gate" || floor === "engine-only", provider).toBe(true)
    }
    // Two bindings have no manifest, and neither routes a tool call through the
    // evaluator, so a tooltip has to carry the caveat for both.
    expect(permissionFloorFor("gemini")).toBe("engine-only")
    expect(permissionFloorFor("openrouter")).toBe("engine-only")
  })
})
