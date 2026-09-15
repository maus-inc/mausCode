/**
 * Hotkeys manager for Agents
 * Centralized keyboard shortcut handling
 *
 * Dispatch is driven by SHORTCUT_TO_ACTION_MAP in agents-actions.ts: every
 * mapped registry id resolves to a registered action, with per-id rules for
 * dedicated listeners and input focus. agents-actions.test.ts keeps the map
 * honest against the shortcut registry.
 */

import * as React from "react"
import { useCallback } from "react"
import type { CustomHotkeysConfig, SettingsTab } from "../../../lib/atoms"
import {
  getResolvedHotkey,
  getShortcutAction,
  isCustomHotkey,
  keysToHotkeyString,
  matchesHotkey,
  matchesShortcutAction,
  type ShortcutActionId,
} from "../../../lib/hotkeys"
import { appStore } from "../../../lib/jotai-store"
import { terminalSidebarOpenAtomFamily } from "../../terminal"
import { diffSidebarOpenAtomFamily } from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import {
  type AgentActionContext,
  executeAgentAction,
  getAvailableAgentActions,
  SHORTCUT_DEDICATED_HANDLERS,
  SHORTCUT_INPUT_SAFE,
  SHORTCUT_TO_ACTION_MAP,
} from "./agents-actions"

// ============================================================================
// TYPES
// ============================================================================

export interface AgentsHotkeysManagerConfig {
  setSelectedChatId?: (id: string | null) => void
  setSelectedDraftId?: (id: string | null) => void
  setShowNewChatForm?: (show: boolean) => void
  requestNewChatFormReset?: () => void
  setDesktopView?: (view: import("../atoms").DesktopView) => void
  setSidebarOpen?: (open: boolean | ((prev: boolean) => boolean)) => void
  setSettingsActiveTab?: (tab: SettingsTab) => void
  setFileSearchDialogOpen?: (open: boolean) => void
  toggleChatSearch?: () => void
  selectedChatId?: string | null
  customHotkeysConfig?: CustomHotkeysConfig
  // Feature flags
  betaKanbanEnabled?: boolean
}

export interface UseAgentsHotkeysOptions {
  enabled?: boolean
  preventDefault?: boolean
}

// ============================================================================
// HOTKEYS MANAGER HOOK
// ============================================================================

const DEFAULT_HOTKEYS_CONFIG: CustomHotkeysConfig = { version: 1, bindings: {} }

export function useAgentsHotkeys(
  config: AgentsHotkeysManagerConfig,
  options: UseAgentsHotkeysOptions = {},
) {
  const { enabled = true, preventDefault = true } = options

  const createActionContext = useCallback(
    (): AgentActionContext => ({
      setSelectedChatId: config.setSelectedChatId,
      setSelectedDraftId: config.setSelectedDraftId,
      setShowNewChatForm: config.setShowNewChatForm,
      requestNewChatFormReset: config.requestNewChatFormReset,
      setDesktopView: config.setDesktopView,
      setSidebarOpen: config.setSidebarOpen,
      setSettingsActiveTab: config.setSettingsActiveTab,
      setFileSearchDialogOpen: config.setFileSearchDialogOpen,
      toggleChatSearch: config.toggleChatSearch,
      selectedChatId: config.selectedChatId,
      getSubChatTabs: () => {
        const store = useAgentSubChatStore.getState()
        return {
          chatId: store.chatId,
          activeSubChatId: store.activeSubChatId,
          openSubChatIds: store.openSubChatIds,
          setActiveSubChat: store.setActiveSubChat,
        }
      },
      toggleDiffSidebar: (chatId) => {
        const sidebarAtom = diffSidebarOpenAtomFamily(chatId)
        appStore.set(sidebarAtom, !appStore.get(sidebarAtom))
      },
      toggleTerminalSidebar: (chatId) => {
        const terminalAtom = terminalSidebarOpenAtomFamily(chatId)
        appStore.set(terminalAtom, !appStore.get(terminalAtom))
      },
    }),
    [
      config.setSelectedChatId,
      config.setSelectedDraftId,
      config.setShowNewChatForm,
      config.requestNewChatFormReset,
      config.setDesktopView,
      config.setSidebarOpen,
      config.setSettingsActiveTab,
      config.setFileSearchDialogOpen,
      config.toggleChatSearch,
      config.selectedChatId,
    ],
  )

  const handleHotkeyAction = useCallback(
    async (actionId: string) => {
      const context = createActionContext()
      const availableActions = getAvailableAgentActions(context)
      const action = availableActions.find((a) => a.id === actionId)

      if (!action) return

      await executeAgentAction(actionId, context, "hotkey")
    },
    [createActionContext],
  )

  // Listen for Cmd+N via IPC from main process (menu accelerator)
  React.useEffect(() => {
    if (!enabled) return
    if (!window.desktopApi?.onShortcutNewAgent) return

    const cleanup = window.desktopApi.onShortcutNewAgent(() => {
      handleHotkeyAction("create-new-agent")
    })

    return cleanup
  }, [enabled, handleHotkeyAction])

  // Listen for Cmd+, via IPC from main process (menu accelerator)
  React.useEffect(() => {
    if (!enabled) return
    if (!window.desktopApi?.onShortcutOpenSettings) return

    const cleanup = window.desktopApi.onShortcutOpenSettings(() => {
      handleHotkeyAction("open-settings")
    })

    return cleanup
  }, [enabled, handleHotkeyAction])

  // Get the resolved hotkey for a shortcut, respecting custom bindings
  const getHotkeyForAction = useCallback(
    (shortcutId: ShortcutActionId): string | null => {
      const customConfig = config.customHotkeysConfig || DEFAULT_HOTKEYS_CONFIG
      return getResolvedHotkey(shortcutId, customConfig)
    },
    [config.customHotkeysConfig],
  )

  // Dedicated hotkey listener for ids whose key handling has extra rules:
  // input-focus exceptions, the file-viewer find exception, the Kanban flag,
  // and the "C" alt key whose primary key belongs to the main-process menu.
  React.useEffect(() => {
    if (!enabled) return

    const customConfig = config.customHotkeysConfig || DEFAULT_HOTKEYS_CONFIG

    const dispatchShortcut = (shortcutId: ShortcutActionId, e: KeyboardEvent) => {
      const actionId = SHORTCUT_TO_ACTION_MAP[shortcutId]
      if (!actionId) return
      e.preventDefault()
      e.stopPropagation()
      handleHotkeyAction(actionId)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement
      const isInputFocused =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.getAttribute("contenteditable") === "true" ||
        activeElement?.closest('[contenteditable="true"]')

      // Check toggle-sidebar hotkey
      const toggleSidebarHotkey = getHotkeyForAction("toggle-sidebar")
      if (toggleSidebarHotkey && matchesHotkey(e, toggleSidebarHotkey)) {
        dispatchShortcut("toggle-sidebar", e)
        return
      }

      // Check show-shortcuts hotkey (only when not in input)
      if (!isInputFocused) {
        const showShortcutsHotkey = getHotkeyForAction("show-shortcuts")
        if (showShortcutsHotkey && matchesHotkey(e, showShortcutsHotkey)) {
          dispatchShortcut("show-shortcuts", e)
          return
        }
      }

      // Check open-settings hotkey
      const openSettingsHotkey = getHotkeyForAction("open-settings")
      if (openSettingsHotkey && matchesHotkey(e, openSettingsHotkey)) {
        dispatchShortcut("open-settings", e)
        return
      }

      // Check search-in-chat hotkey
      // Skip if focus is inside a file viewer Monaco editor so Cmd+F triggers editor find
      const searchInChatHotkey = getHotkeyForAction("search-in-chat")
      if (searchInChatHotkey && matchesHotkey(e, searchInChatHotkey)) {
        const active = document.activeElement
        const isInFileViewer = active?.closest?.("[data-file-viewer-path]")
        if (!isInFileViewer) {
          dispatchShortcut("search-in-chat", e)
          return
        }
      }

      // Check file-search hotkey (Cmd+P)
      const fileSearchHotkey = getHotkeyForAction("file-search")
      if (fileSearchHotkey && matchesHotkey(e, fileSearchHotkey)) {
        dispatchShortcut("file-search", e)
        return
      }

      // Check open-kanban hotkey (only if feature is enabled)
      if (config.betaKanbanEnabled) {
        const openKanbanHotkey = getHotkeyForAction("open-kanban")
        if (openKanbanHotkey && matchesHotkey(e, openKanbanHotkey)) {
          dispatchShortcut("open-kanban", e)
          return
        }
      }

      // Check new-workspace alt key ("C") — only when not in input. The
      // primary Cmd+N belongs to the main-process menu accelerator and is not
      // rebindable here.
      const newWorkspaceAction = getShortcutAction("new-workspace")
      if (
        !isInputFocused &&
        !isCustomHotkey("new-workspace", customConfig) &&
        newWorkspaceAction?.altKeys?.length
      ) {
        const altHotkey = keysToHotkeyString(newWorkspaceAction.altKeys)
        if (matchesHotkey(e, altHotkey)) {
          dispatchShortcut("new-workspace", e)
          return
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [
    enabled,
    handleHotkeyAction,
    getHotkeyForAction,
    config.betaKanbanEnabled,
    config.customHotkeysConfig,
  ])

  // Generic shortcut loop for every other mapped id, resolved against custom
  // bindings. Ids with dedicated rules above are skipped to avoid double
  // dispatch.
  React.useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable

      const customConfig = config.customHotkeysConfig || DEFAULT_HOTKEYS_CONFIG

      for (const shortcutId of Object.keys(SHORTCUT_TO_ACTION_MAP) as ShortcutActionId[]) {
        if (SHORTCUT_DEDICATED_HANDLERS[shortcutId]) continue
        if (isInInput && !SHORTCUT_INPUT_SAFE[shortcutId]) continue

        const actionId = SHORTCUT_TO_ACTION_MAP[shortcutId]
        if (!actionId) continue

        if (matchesShortcutAction(e, shortcutId, customConfig)) {
          if (preventDefault) {
            e.preventDefault()
            e.stopPropagation()
          }
          handleHotkeyAction(actionId)
          return
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [enabled, preventDefault, handleHotkeyAction, config.customHotkeysConfig])

  return {
    executeAction: handleHotkeyAction,
    getAvailableActions: () => getAvailableAgentActions(createActionContext()),
    createActionContext,
  }
}
