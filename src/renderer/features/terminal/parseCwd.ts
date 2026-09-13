/**
 * Parse current working directory from terminal output.
 * Shells can report the cwd via OSC 7 escape sequences.
 */

/**
 * Parse OSC 7 sequences to extract current working directory.
 * Format: \x1b]7;file://hostname/path\x07 or \x1b]7;file://hostname/path\x1b\\
 *
 * @param data - Terminal output data
 * @returns The parsed cwd path or null if not found
 */
// The two control characters the OSC 7 grammar is built from. Naming them keeps
// the pattern readable and keeps raw control characters out of regex literals;
// the assembled source is the same expression the literal spelled.
const ESC = "\u001b"
const BEL = "\u0007"

export function parseCwd(data: string): string | null {
  // OSC 7 with BEL terminator: \x1b]7;file://hostname/path\x07
  // OSC 7 with ST terminator: \x1b]7;file://hostname/path\x1b\\
  // Constructed per call because the loop below drives it with exec(), which
  // advances `lastIndex` on a global regex.
  const osc7Pattern = new RegExp(
    `${ESC}\\]7;file://[^/]*([^${BEL}${ESC}]+)(?:${BEL}|${ESC}\\\\)`,
    "g",
  )

  let match: RegExpExecArray | null
  let lastCwd: string | null = null

  // Find all matches and return the last one (most recent)
  for (match = osc7Pattern.exec(data); match !== null; match = osc7Pattern.exec(data)) {
    if (match[1]) {
      try {
        lastCwd = decodeURIComponent(match[1])
      } catch {
        // Invalid URL encoding, use as-is
        lastCwd = match[1]
      }
    }
  }

  return lastCwd
}
