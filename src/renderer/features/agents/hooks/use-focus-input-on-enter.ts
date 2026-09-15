import { useAtomValue } from "jotai"
import { type RefObject, useEffect } from "react"
import { customHotkeysAtom } from "../../../lib/atoms"
import { matchesShortcutAction } from "../../../lib/hotkeys"

/**
 * Hook to focus an input element when the focus-input shortcut is pressed
 * (Enter by default, custom bindings respected) and no other input is
 * currently focused.
 *
 * @param editorRef - Ref to the editor/input element that should be focused
 */
export function useFocusInputOnEnter(
  editorRef: RefObject<{ focus: () => void } | null>,
  enabled = true,
) {
  const customHotkeys = useAtomValue(customHotkeysAtom)

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!matchesShortcutAction(e, "focus-input", customHotkeys)) {
        return
      }

      // Don't handle if inside a dialog/modal/overlay
      const target = e.target as HTMLElement
      const isInsideOverlay = target.closest(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-state="open"]',
      )
      if (isInsideOverlay) {
        return
      }

      // Check if user is already in an input/textarea/contenteditable
      const activeElement = document.activeElement
      const isInputFocused =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.getAttribute("contenteditable") === "true" ||
        activeElement?.closest('[contenteditable="true"]')

      if (isInputFocused) {
        return
      }

      // Focus the editor
      e.preventDefault()
      editorRef.current?.focus()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [editorRef, enabled, customHotkeys])
}
