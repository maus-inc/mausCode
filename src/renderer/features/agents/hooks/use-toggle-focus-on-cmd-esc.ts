import { useAtomValue } from "jotai"
import { type RefObject, useEffect } from "react"
import { customHotkeysAtom } from "../../../lib/atoms"
import { matchesShortcutAction } from "../../../lib/hotkeys"

/**
 * Hook to toggle focus when the toggle-focus shortcut is pressed
 * (Cmd+Esc by default, custom bindings respected).
 * - If focused → blur
 * - If not focused → focus
 * Does not interfere with stop generation (Esc without modifiers).
 *
 * @param editorRef - Ref to the editor/input element
 */
export function useToggleFocusOnCmdEsc(
  editorRef: RefObject<{ focus: () => void; blur: () => void } | null>,
  enabled = true,
) {
  const customHotkeys = useAtomValue(customHotkeysAtom)

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!matchesShortcutAction(e, "toggle-focus", customHotkeys)) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      const editor = editorRef.current
      if (!editor) return

      // Check if any input/contenteditable is currently focused
      const activeElement = document.activeElement
      const isInputFocused =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.getAttribute("contenteditable") === "true" ||
        (activeElement?.hasAttribute("contenteditable") &&
          activeElement.getAttribute("contenteditable") !== "false")

      if (isInputFocused) {
        // Blur if any input is focused
        editor.blur()
      } else {
        // Focus if no input is focused
        editor.focus()
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true })
  }, [editorRef, enabled, customHotkeys])
}
