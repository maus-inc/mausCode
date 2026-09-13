/**
 * Utilities for managing command buffer and extracting tab titles.
 */

/**
 * Sanitize a command string for use as a tab title.
 * Removes control characters, trims whitespace, and limits length.
 *
 * @param command - The raw command buffer contents
 * @returns A sanitized string suitable for use as a tab title
 */
// Two passes, matching what the terminal protocol actually produces: strip CSI
// sequences first, then drop every remaining C0 control code point plus DEL.
// The escape matcher is assembled from a named constant so no regex literal in
// this file carries a raw control character; sharing a global regex is safe
// because `String.prototype.replace` resets `lastIndex` before it scans. The
// second pass is a code-point filter rather than a character-class regex, which
// keeps `useRegexLiterals` satisfied as well.
const ESC = "\u001b"
const ANSI_CSI_SEQUENCE = new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, "g")

function isControlCodePoint(code: number): boolean {
  return code < 0x20 || code === 0x7f
}

export function sanitizeForTitle(command: string): string {
  if (!command) return ""

  // Remove ANSI escape sequences
  let cleaned = command.replace(ANSI_CSI_SEQUENCE, "")

  // Remove other control characters
  cleaned = Array.from(cleaned, (ch) =>
    isControlCodePoint(ch.codePointAt(0) ?? 0) ? "" : ch,
  ).join("")

  // Trim and limit length
  cleaned = cleaned.trim()

  if (cleaned.length > 50) {
    cleaned = `${cleaned.slice(0, 47)}...`
  }

  return cleaned
}
