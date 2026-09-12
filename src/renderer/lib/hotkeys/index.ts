// Types

// Registry
export {
  ALL_SHORTCUT_ACTIONS,
  CATEGORY_LABELS,
  detectConflicts,
  getResolvedHotkey,
  getResolvedKeys,
  getShortcutAction,
  getShortcutsByCategory,
  hotkeyStringToKeys,
  hotkeyToDisplay,
  isCustomHotkey,
  keysToDisplay,
  keysToHotkeyString,
  keyToDisplay,
  normalizeHotkey,
} from "./shortcut-registry"
export type {
  CustomHotkeysConfig,
  ShortcutAction,
  ShortcutActionId,
  ShortcutCategory,
  ShortcutConflict,
} from "./types"
export type {
  UseHotkeyRecorderOptions,
  UseHotkeyRecorderResult,
} from "./use-hotkey-recorder"
// Hooks
export { useHotkeyRecorder } from "./use-hotkey-recorder"

export {
  useResolvedHotkeyDisplay,
  useResolvedHotkeyDisplayWithAlt,
} from "./use-resolved-hotkey-display"
