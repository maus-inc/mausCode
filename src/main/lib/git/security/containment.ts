/**
 * Worktree containment: the checks that decide whether a path a caller named
 * stays inside the worktree it was scoped to.
 *
 * Pure node builtins and `./errors`, no database. Two callers need exactly the
 * same answer and must not be able to drift: the tRPC file endpoints, where a
 * renderer names a worktree-relative path, and the permission gate in
 * `src/main/lib/permissions/`, where a provider tool names an absolute one.
 *
 * The threat model these checks serve is documented in `path-validation.ts`.
 */
import { lstat, readlink, realpath } from "node:fs/promises"
import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path"
import { PathValidationError } from "./errors"

/**
 * Check if a resolved path is within the worktree boundary using path.relative().
 * This is safer than string prefix matching which can have boundary bugs.
 */
export function isPathWithinWorktree(worktreeReal: string, targetReal: string): boolean {
  if (targetReal === worktreeReal) {
    return true
  }
  const relativePath = relative(worktreeReal, targetReal)
  // Check if path escapes worktree:
  // - ".." means direct parent
  // - "../" prefix means ancestor escape (use sep for cross-platform)
  // - Absolute path means completely outside
  // Note: Don't use startsWith("..") as it incorrectly catches "..config" directories
  // Note: Empty relativePath ("") case is already handled by the equality check above
  const escapesWorktree =
    relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)

  return !escapesWorktree
}

/**
 * Validate that the parent directory chain stays within the worktree.
 * Handles the case where the target file doesn't exist yet (ENOENT).
 *
 * This function walks up the directory tree to find the first existing
 * ancestor and validates it. It also detects dangling symlinks by checking
 * if any component is a symlink pointing outside the worktree.
 *
 * @throws PathValidationError if any ancestor escapes the worktree
 */
export async function assertParentInWorktree(
  worktreePath: string,
  fullPath: string,
): Promise<void> {
  const worktreeReal = await realpath(worktreePath)
  let currentPath = dirname(fullPath)

  // Walk up the directory tree until we find an existing directory
  while (currentPath !== dirname(currentPath)) {
    // Stop at filesystem root
    try {
      // First check if this path component is a symlink (even if target doesn't exist)
      const stats = await lstat(currentPath)

      if (stats.isSymbolicLink()) {
        // This is a symlink - validate its target even if it doesn't exist
        const linkTarget = await readlink(currentPath)
        // Resolve the link target relative to the symlink's parent
        const resolvedTarget = isAbsolute(linkTarget)
          ? linkTarget
          : resolve(dirname(currentPath), linkTarget)

        // Try to get the realpath of the resolved target
        try {
          const targetReal = await realpath(resolvedTarget)
          if (!isPathWithinWorktree(worktreeReal, targetReal)) {
            throw new PathValidationError(
              "Symlink in path resolves outside the worktree",
              "SYMLINK_ESCAPE",
            )
          }
        } catch (error) {
          // Target doesn't exist - check if the resolved target path
          // would be within worktree if it existed
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            // For dangling symlinks, validate the target path itself
            // We need to check if the target, when resolved, would be in worktree
            // This is conservative: if we can't determine, fail closed
            const targetRelative = relative(worktreeReal, resolvedTarget)
            // Use sep-aware check to avoid false positives on "..config" dirs
            if (
              targetRelative === ".." ||
              targetRelative.startsWith(`..${sep}`) ||
              isAbsolute(targetRelative)
            ) {
              throw new PathValidationError(
                "Dangling symlink points outside the worktree",
                "SYMLINK_ESCAPE",
              )
            }
            // Target would be within worktree if it existed - continue
            return
          }
          if (error instanceof PathValidationError) {
            throw error
          }
          // Other errors - fail closed for security
          throw new PathValidationError("Cannot validate symlink target", "SYMLINK_ESCAPE")
        }
        return // Symlink validated successfully
      }

      // Not a symlink - get realpath and validate
      const parentReal = await realpath(currentPath)
      if (!isPathWithinWorktree(worktreeReal, parentReal)) {
        throw new PathValidationError(
          "Parent directory resolves outside the worktree",
          "SYMLINK_ESCAPE",
        )
      }
      return // Found valid ancestor
    } catch (error) {
      if (error instanceof PathValidationError) {
        throw error
      }
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        // This ancestor doesn't exist either, keep walking up
        currentPath = dirname(currentPath)
        continue
      }
      // Other errors (EACCES, ENOTDIR, etc.) - fail closed for security
      throw new PathValidationError("Cannot validate path ancestry", "SYMLINK_ESCAPE")
    }
  }

  // Reached filesystem root without finding valid ancestor
  throw new PathValidationError(
    "Could not validate path ancestry within worktree",
    "SYMLINK_ESCAPE",
  )
}

/**
 * Check if the resolved realpath stays within the worktree boundary.
 * Prevents symlink escape attacks where a symlink points outside the worktree.
 *
 * @throws PathValidationError if realpath escapes worktree
 */
export async function assertRealpathInWorktree(
  worktreePath: string,
  fullPath: string,
): Promise<void> {
  try {
    const real = await realpath(fullPath)
    const worktreeReal = await realpath(worktreePath)

    // Use path.relative for safer boundary checking
    if (!isPathWithinWorktree(worktreeReal, real)) {
      throw new PathValidationError(
        "File is a symlink pointing outside the worktree",
        "SYMLINK_ESCAPE",
      )
    }
  } catch (error) {
    // If realpath fails with ENOENT, the target doesn't exist
    // But the path itself might be a dangling symlink - check that first!
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await assertDanglingSymlinkSafe(worktreePath, fullPath)
      return
    }
    // Re-throw PathValidationError
    if (error instanceof PathValidationError) {
      throw error
    }
    // Other errors (permission denied, etc.) - fail closed for security
    throw new PathValidationError("Cannot validate file path", "SYMLINK_ESCAPE")
  }
}

/**
 * Handle the ENOENT case: check if fullPath is a dangling symlink pointing outside
 * the worktree, or if it truly doesn't exist (in which case validate parent chain).
 *
 * Attack scenario this prevents:
 * - Repo contains `docs/config.yml` → symlink to `~/.ssh/some_new_file` (doesn't exist)
 * - realpath() fails with ENOENT (target missing)
 * - Without this check, we'd only validate parent (`docs/`) which is valid
 * - Write would follow symlink and create `~/.ssh/some_new_file`
 *
 * @throws PathValidationError if symlink escapes worktree
 */
async function assertDanglingSymlinkSafe(worktreePath: string, fullPath: string): Promise<void> {
  const worktreeReal = await realpath(worktreePath)

  try {
    // Check if the path itself exists (as a symlink or otherwise)
    const stats = await lstat(fullPath)

    if (stats.isSymbolicLink()) {
      // It's a dangling symlink - validate where it points
      const linkTarget = await readlink(fullPath)
      const resolvedTarget = isAbsolute(linkTarget)
        ? linkTarget
        : resolve(dirname(fullPath), linkTarget)

      // Check if the resolved target would be within worktree
      // For dangling symlinks, we can't use realpath on the target,
      // so we check the literal resolved path
      const targetRelative = relative(worktreeReal, resolvedTarget)
      if (
        targetRelative === ".." ||
        targetRelative.startsWith(`..${sep}`) ||
        isAbsolute(targetRelative)
      ) {
        throw new PathValidationError(
          "Dangling symlink points outside the worktree",
          "SYMLINK_ESCAPE",
        )
      }
      // Dangling symlink points within worktree - allow the operation
      return
    }

    // Not a symlink but lstat succeeded - weird state, but validate parent chain
    await assertParentInWorktree(worktreePath, fullPath)
  } catch (error) {
    if (error instanceof PathValidationError) {
      throw error
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      // Path truly doesn't exist (not even as a symlink) - validate parent chain
      await assertParentInWorktree(worktreePath, fullPath)
      return
    }
    // Other errors - fail closed
    throw new PathValidationError("Cannot validate path", "SYMLINK_ESCAPE")
  }
}

/**
 * Options for path validation.
 */
export interface ValidatePathOptions {
  /**
   * Allow empty/root path (resolves to worktree itself).
   * Default: false (prevents accidental worktree deletion)
   */
  allowRoot?: boolean
}

/**
 * Validates a relative file path for safety.
 * Rejects absolute paths and path traversal attempts.
 *
 * @throws PathValidationError if path is invalid
 */
export function validateRelativePath(filePath: string, options: ValidatePathOptions = {}): void {
  const { allowRoot = false } = options

  // Reject absolute paths
  if (isAbsolute(filePath)) {
    throw new PathValidationError("Absolute paths are not allowed", "ABSOLUTE_PATH")
  }

  const normalized = normalize(filePath)
  const segments = normalized.split(sep)

  // Reject ".." as a path segment (allows "..foo" directories)
  if (segments.includes("..")) {
    throw new PathValidationError("Path traversal not allowed", "PATH_TRAVERSAL")
  }

  // Reject root path unless explicitly allowed
  if (!allowRoot && (normalized === "" || normalized === ".")) {
    throw new PathValidationError("Cannot target worktree root", "INVALID_TARGET")
  }
}

/**
 * Validates and resolves a path within a worktree. Sync, simple.
 *
 * @param worktreePath - The worktree base path
 * @param filePath - The relative file path to validate
 * @param options - Validation options
 * @returns The resolved full path
 * @throws PathValidationError if path is invalid
 */
export function resolvePathInWorktree(
  worktreePath: string,
  filePath: string,
  options: ValidatePathOptions = {},
): string {
  validateRelativePath(filePath, options)
  // Use resolve to handle any worktreePath (relative or absolute)
  return resolve(worktreePath, normalize(filePath))
}

/**
 * Validates a path for git commands. Lighter check that allows root.
 *
 * @throws PathValidationError if path is invalid
 */
export function assertValidGitPath(filePath: string): void {
  validateRelativePath(filePath, { allowRoot: true })
}

/**
 * Validate a path an agent tool named, against the worktree the run is scoped
 * to, and answer its worktree-relative form.
 *
 * Provider tools hand over absolute paths, unlike the tRPC file endpoints that
 * take worktree-relative ones, so this is the absolute-path sibling of
 * `resolvePathInWorktree`. It runs the checks in the order `FULL-REVIEW.md`
 * section 6.3 requires: shape first, then literal containment, then
 * canonicalised containment through symlinks.
 *
 * It does not require database registration. That boundary belongs to the tRPC
 * file endpoints, where a renderer names the workspace; here the run's own cwd
 * is already the workspace the app chose, and re-checking it would deny every
 * tool call in a scratch session.
 *
 * @throws PathValidationError with PATH_TRAVERSAL, SYMLINK_ESCAPE or INVALID_TARGET
 */
export async function assertToolPathInWorktree(
  worktreePath: string,
  candidatePath: string,
): Promise<string> {
  if (candidatePath.trim().length === 0) {
    throw new PathValidationError("Tool call named an empty path", "INVALID_TARGET")
  }

  if (isAbsolute(candidatePath)) {
    if (normalize(candidatePath).split(sep).includes("..")) {
      throw new PathValidationError("Path traversal not allowed", "PATH_TRAVERSAL")
    }
  } else {
    validateRelativePath(candidatePath)
  }

  const worktreeRoot = resolve(worktreePath)
  const fullPath = resolve(worktreeRoot, candidatePath)
  if (!isPathWithinWorktree(worktreeRoot, fullPath)) {
    throw new PathValidationError("Path resolves outside the worktree", "PATH_TRAVERSAL")
  }

  await assertRealpathInWorktree(worktreeRoot, fullPath)
  return relative(worktreeRoot, fullPath)
}
