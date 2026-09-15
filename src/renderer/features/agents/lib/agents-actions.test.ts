import { describe, expect, it } from "vitest"
// Imported from the registry modules, not the hotkeys barrel: the barrel
// exports React hooks whose module graph touches window storage, which does
// not exist in the node test environment.
import {
  ALL_SHORTCUT_ACTIONS,
  getResolvedHotkey,
  normalizeHotkey,
} from "../../../lib/hotkeys/shortcut-registry"
import type { CustomHotkeysConfig, ShortcutActionId } from "../../../lib/hotkeys/types"
import {
  AGENT_ACTIONS,
  type AgentActionContext,
  COMPONENT_OWNED_SHORTCUTS,
  executeAgentAction,
  SHORTCUT_DEDICATED_HANDLERS,
  SHORTCUT_INPUT_SAFE,
  SHORTCUT_TO_ACTION_MAP,
  type SubChatTabsSlice,
} from "./agents-actions"

const DEFAULT_CONFIG: CustomHotkeysConfig = { version: 1, bindings: {} }

const registryIds = ALL_SHORTCUT_ACTIONS.map((action) => action.id)
const mappedIds = Object.keys(SHORTCUT_TO_ACTION_MAP) as ShortcutActionId[]
const ownedIds = Object.keys(COMPONENT_OWNED_SHORTCUTS) as ShortcutActionId[]

describe("shortcut registry reconciliation", () => {
  it("resolves every mapped shortcut id to a registered action", () => {
    for (const [shortcutId, actionId] of Object.entries(SHORTCUT_TO_ACTION_MAP)) {
      expect(actionId, `shortcut ${shortcutId} has no mapped action`).toBeTruthy()
      expect(
        AGENT_ACTIONS[actionId as string],
        `shortcut ${shortcutId} maps to unregistered action ${actionId}`,
      ).toBeDefined()
    }
  })

  it("maps or explicitly owns every shortcut registry id exactly once", () => {
    for (const id of registryIds) {
      expect(
        SHORTCUT_TO_ACTION_MAP[id] !== undefined || COMPONENT_OWNED_SHORTCUTS[id] !== undefined,
        `registry id ${id} is neither mapped to an action nor owned by a component`,
      ).toBe(true)
    }

    const knownIds = new Set([...mappedIds, ...ownedIds])
    for (const id of knownIds) {
      expect(
        registryIds.includes(id),
        `${id} appears in the bridge tables but not in the shortcut registry`,
      ).toBe(true)
    }

    const overlap = mappedIds.filter((id) => COMPONENT_OWNED_SHORTCUTS[id] !== undefined)
    expect(overlap, `ids both mapped and component-owned: ${overlap.join(", ")}`).toEqual([])

    expect(knownIds.size).toBe(registryIds.length)
  })

  it("keeps dedicated-handler and input-safe flags inside the mapped set", () => {
    for (const id of Object.keys(SHORTCUT_DEDICATED_HANDLERS) as ShortcutActionId[]) {
      expect(
        SHORTCUT_TO_ACTION_MAP[id],
        `dedicated-handler id ${id} is missing from SHORTCUT_TO_ACTION_MAP`,
      ).toBeDefined()
    }

    for (const id of Object.keys(SHORTCUT_INPUT_SAFE) as ShortcutActionId[]) {
      expect(
        SHORTCUT_TO_ACTION_MAP[id],
        `input-safe id ${id} is missing from SHORTCUT_TO_ACTION_MAP`,
      ).toBeDefined()
    }
  })

  it("has a default key for every mapped id so the loop can dispatch it", () => {
    for (const id of mappedIds) {
      const hotkey = getResolvedHotkey(id, DEFAULT_CONFIG)
      expect(hotkey, `mapped id ${id} resolves to no default hotkey`).toBeTruthy()
      expect(hotkey?.length).toBeGreaterThan(0)
    }
  })

  it("never maps two ids onto the same default key", () => {
    const seen = new Map<string, ShortcutActionId>()
    for (const id of mappedIds) {
      const hotkey = getResolvedHotkey(id, DEFAULT_CONFIG)
      if (!hotkey) continue
      const normalized = normalizeHotkey(hotkey)
      const firstId = seen.get(normalized)
      expect(
        firstId,
        `${id} and ${firstId} both default to ${normalized}; the generic loop would race`,
      ).toBeUndefined()
      seen.set(normalized, id)
    }
  })

  it("names an owning module for every component-owned id", () => {
    for (const [id, owner] of Object.entries(COMPONENT_OWNED_SHORTCUTS)) {
      expect(owner, `component-owned id ${id} has no owner recorded`).toBeTruthy()
    }
  })
})

function makeTabs(openIds: string[], activeId: string | null, chatId: string | null = "chat-1") {
  const selected: string[] = []
  const tabs: SubChatTabsSlice = {
    chatId,
    activeSubChatId: activeId,
    openSubChatIds: openIds,
    setActiveSubChat: (id) => selected.push(id),
  }
  return { tabs, selected }
}

function contextWith(tabs: SubChatTabsSlice | null, extra: Partial<AgentActionContext> = {}) {
  const context: AgentActionContext = { getSubChatTabs: () => tabs, ...extra }
  return context
}

describe("sub-chat tab actions", () => {
  it("previous tab wraps from the first to the last tab", async () => {
    const { tabs, selected } = makeTabs(["a", "b", "c"], "a")
    const result = await executeAgentAction("prev-agent", contextWith(tabs), "hotkey")
    expect(result).toEqual({ success: true })
    expect(selected).toEqual(["c"])
  })

  it("next tab wraps from the last to the first tab", async () => {
    const { tabs, selected } = makeTabs(["a", "b", "c"], "c")
    const result = await executeAgentAction("next-agent", contextWith(tabs), "hotkey")
    expect(result).toEqual({ success: true })
    expect(selected).toEqual(["a"])
  })

  it("selects the first tab when no tab is active", async () => {
    const { tabs, selected } = makeTabs(["a", "b"], null)
    const result = await executeAgentAction("next-agent", contextWith(tabs), "hotkey")
    expect(result).toEqual({ success: true })
    expect(selected).toEqual(["a"])
  })

  it("refuses to navigate with a single open tab", async () => {
    const { tabs, selected } = makeTabs(["a"], "a")
    const result = await executeAgentAction("next-agent", contextWith(tabs), "hotkey")
    expect(result.success).toBe(false)
    expect(selected).toEqual([])
  })

  it("refuses to navigate when no chat is open", async () => {
    const result = await executeAgentAction("next-agent", contextWith(null), "hotkey")
    expect(result.success).toBe(false)
  })
})

describe("sidebar toggle actions", () => {
  it("open-diff toggles through the injected callback for the open chat", async () => {
    const toggled: string[] = []
    const { tabs } = makeTabs(["a"], "a")
    const context = contextWith(tabs, {
      toggleDiffSidebar: (chatId) => toggled.push(chatId),
    })
    const result = await executeAgentAction("open-diff", context, "hotkey")
    expect(result).toEqual({ success: true })
    expect(toggled).toEqual(["chat-1"])
  })

  it("toggle-terminal toggles through the injected callback for the open chat", async () => {
    const toggled: string[] = []
    const { tabs } = makeTabs(["a"], "a")
    const context = contextWith(tabs, {
      toggleTerminalSidebar: (chatId) => toggled.push(chatId),
    })
    const result = await executeAgentAction("toggle-terminal", context, "hotkey")
    expect(result).toEqual({ success: true })
    expect(toggled).toEqual(["chat-1"])
  })

  it("open-diff and toggle-terminal refuse without a chat", async () => {
    expect((await executeAgentAction("open-diff", contextWith(null), "hotkey")).success).toBe(false)
    expect((await executeAgentAction("toggle-terminal", contextWith(null), "hotkey")).success).toBe(
      false,
    )
  })
})
