import { isAbsolute, relative, sep } from "node:path"

/**
 * Canonical directory-containment check for the main process.
 *
 * Both arguments MUST already be canonical (see `realpath`): this function is a
 * pure string/geometry test and deliberately performs no filesystem access, so
 * it never hides a TOCTOU window behind a "secure" looking API.
 *
 * Why not `candidate.startsWith(root)`?
 * Prefix matching accepts sibling directories that merely share a string
 * prefix (`/home/u/.vscode/extensionsEVIL` matches `/home/u/.vscode/extensions`),
 * which is exactly the bypass this module exists to prevent. `path.relative()`
 * compares real path segments instead.
 *
 * Note: `relative()` returns `".."` for the parent and `"../x"` for anything
 * above the root. `startsWith("..")` alone would be wrong because it also
 * matches legitimate names such as `..config`.
 */
export function isPathWithinRoot(root: string, candidate: string): boolean {
  if (candidate === root) return true
  const relativePath = relative(root, candidate)
  return !(
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  )
}

/**
 * Containment check against several allowed roots (e.g. every editor's
 * extensions directory). Returns true if the candidate sits inside any root.
 */
export function isPathWithinRoots(
  roots: readonly string[],
  candidate: string,
): boolean {
  return roots.some((root) => isPathWithinRoot(root, candidate))
}
