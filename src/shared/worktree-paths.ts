/**
 * Worktree path helpers shared by the main process and the renderer.
 *
 * mausCode creates git worktrees under `~/.mauscode/worktrees/{project}/{folder}`.
 * Paths created by 1Code (legacy `~/.21st/worktrees/...`) are still recognized
 * so worktrees created before the rebrand keep resolving. Legacy locations are
 * read-only support: mausCode never writes to them (see
 * .dump/rebrand/decisions/open-decisions.md D3).
 */

/** Normalizes Windows separators so matching is platform-independent. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/")
}

/** Markers of a worktree base path inside a full path (current + legacy). */
const WORKTREE_MARKERS = [
  "/.mauscode/worktrees/",
  "/.21st/worktrees/", // legacy 1Code location — detection only
] as const

/** True if the path is inside a mausCode (or legacy 1Code) worktrees directory. */
export function isWorktreePath(filePath: string): boolean {
  const p = normalizePath(filePath)
  return WORKTREE_MARKERS.some((marker) => p.includes(marker))
}

/**
 * Extract the project-relative path from a worktree path.
 *
 * Worktree layout: `{base}/worktrees/{projectSlug}/{worktreeFolder}/{relative...}`
 *
 * @returns the relative path (at least one segment), or null if the path is
 *          not a resolvable worktree path.
 */
export function parseWorktreeRelativePath(filePath: string): string | null {
  const p = normalizePath(filePath)
  for (const marker of WORKTREE_MARKERS) {
    const idx = p.indexOf(marker)
    if (idx === -1) continue
    // After the marker: {projectSlug}/{worktreeFolder}/{relative...}
    const parts = p.slice(idx + marker.length).split("/")
    if (parts.length < 3 || !parts[0] || !parts[1]) return null
    const relative = parts.slice(2).join("/")
    return relative.length > 0 ? relative : null
  }
  return null
}
