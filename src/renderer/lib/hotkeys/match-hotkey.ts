import {
  getResolvedHotkey,
  getShortcutAction,
  isCustomHotkey,
  keysToHotkeyString,
} from "./shortcut-registry"
import type { CustomHotkeysConfig, ShortcutActionId } from "./types"

/**
 * Parse a hotkey string and match against a keyboard event
 * Supports: "?", "shift+?", "cmd+k", "cmd+shift+i"
 */
export function matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.toLowerCase().split("+")
  const key = parts[parts.length - 1]
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

  const eventKey = e.key.toLowerCase()
  const eventCode = e.code.toLowerCase()

  if (eventKey === key) return true
  if (key === "?" && eventKey === "?") return true
  if ((key === "esc" || key === "escape") && eventKey === "escape") return true
  if (key === "space" && (eventKey === " " || eventCode === "space")) return true
  if (key === "↑" && eventKey === "arrowup") return true
  if (key === "↓" && eventKey === "arrowdown") return true
  if (key === "←" && eventKey === "arrowleft") return true
  if (key === "→" && eventKey === "arrowright") return true
  if (key === "/" && (eventKey === "/" || eventCode === "slash")) return true
  if (key === "\\" && (eventKey === "\\" || eventCode === "backslash")) return true
  if (key === "," && (eventKey === "," || eventCode === "comma")) return true
  if (key === "[" && (eventKey === "[" || eventCode === "bracketleft")) return true
  if (key === "]" && (eventKey === "]" || eventCode === "bracketright")) return true
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
