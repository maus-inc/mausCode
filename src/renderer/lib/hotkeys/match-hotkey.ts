import {
  getResolvedHotkey,
  getShortcutAction,
  isCustomHotkey,
  keysToHotkeyString,
} from "./shortcut-registry"
import type { CustomHotkeysConfig, ShortcutActionId } from "./types"

/**
 * Event keys and event codes that satisfy a registry key beyond direct
 * comparison with e.key. Codes are layout-independent, so they are listed
 * wherever a physical key position matters.
 */
const KEY_ALIASES: Record<string, { keys?: string[]; codes?: string[] }> = {
  esc: { keys: ["escape"] },
  escape: { keys: ["escape"] },
  space: { keys: [" "], codes: ["space"] },
  "↑": { keys: ["arrowup"], codes: ["arrowup"] },
  "↓": { keys: ["arrowdown"], codes: ["arrowdown"] },
  "←": { keys: ["arrowleft"], codes: ["arrowleft"] },
  "→": { keys: ["arrowright"], codes: ["arrowright"] },
  "/": { keys: ["/"], codes: ["slash"] },
  "\\": { keys: ["\\"], codes: ["backslash"] },
  ",": { keys: [","], codes: ["comma"] },
  "[": { keys: ["["], codes: ["bracketleft"] },
  "]": { keys: ["]"], codes: ["bracketright"] },
}

/**
 * Parse a hotkey string and match against a keyboard event
 * Supports: "?", "shift+?", "cmd+k", "cmd+shift+i"
 */
export function matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.toLowerCase().split("+")
  const key = parts.at(-1)
  const modifiers = parts.slice(0, -1)

  const needsMeta = modifiers.includes("cmd") || modifiers.includes("meta")
  const needsAlt = modifiers.includes("opt") || modifiers.includes("alt")
  const needsCtrl = modifiers.includes("ctrl")
  let needsShift = modifiers.includes("shift")

  // "?" requires shift implicitly
  if (key === "?" && !modifiers.includes("shift")) {
    needsShift = true
  }

  if (needsMeta !== e.metaKey) return false
  if (needsAlt !== e.altKey) return false
  if (needsCtrl !== e.ctrlKey) return false
  if (needsShift !== e.shiftKey) return false
  if (!key) return false

  const eventKey = e.key.toLowerCase()
  const eventCode = e.code.toLowerCase()

  if (eventKey === key) return true

  const alias = KEY_ALIASES[key]
  if (alias && (alias.keys?.includes(eventKey) || alias.codes?.includes(eventCode))) {
    return true
  }

  if (key.length === 1 && eventCode === `key${key}`) return true

  return false
}

/**
 * Match a keyboard event against a shortcut registry id, honouring the user's
 * custom binding. Falls back to the action's altKeys only while the primary
 * binding is uncustomized, which keeps "Esc or Ctrl+C" style shortcuts working
 * together until the user picks their own key.
 */
export function matchesShortcutAction(
  e: KeyboardEvent,
  actionId: ShortcutActionId,
  config: CustomHotkeysConfig,
): boolean {
  const primary = getResolvedHotkey(actionId, config)
  if (primary && matchesHotkey(e, primary)) return true

  if (isCustomHotkey(actionId, config)) return false

  const action = getShortcutAction(actionId)
  if (!action?.altKeys?.length) return false
  return matchesHotkey(e, keysToHotkeyString(action.altKeys))
}
