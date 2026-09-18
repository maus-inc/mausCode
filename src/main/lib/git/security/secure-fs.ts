import type { Stats } from "node:fs"
import { lstat, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import {
  assertRealpathInWorktree,
  isPathWithinWorktree,
  resolvePathInWorktree,
} from "./containment"
import { assertRegisteredWorktree } from "./path-validation"

/**
 * Secure filesystem operations with built-in validation.
 *
 * Each operation:
 * 1. Validates worktree is registered (security boundary)
 * 2. Validates path doesn't escape worktree (defense in depth)
 * 3. For writes: validates target is not a symlink escaping worktree
 * 4. Performs the filesystem operation
 *
 * See path-validation.ts for the full security model and threat assumptions.
 */

export const secureFs = {
  /**
   * Read a file within a worktree.
   *
   * SECURITY: Enforces symlink-escape check. If the file is a symlink
   * pointing outside the worktree, this will throw PathValidationError.
   *
   * @throws PathValidationError with code "SYMLINK_ESCAPE" if file escapes worktree
   */
  async readFile(
    worktreePath: string,
    filePath: string,
    encoding: BufferEncoding = "utf-8",
  ): Promise<string> {
    assertRegisteredWorktree(worktreePath)
    const fullPath = resolvePathInWorktree(worktreePath, filePath)

    // Block reads through symlinks that escape the worktree
    await assertRealpathInWorktree(worktreePath, fullPath)

    return readFile(fullPath, encoding)
  },

  /**
   * Read a file as a Buffer within a worktree.
   *
   * SECURITY: Enforces symlink-escape check. If the file is a symlink
   * pointing outside the worktree, this will throw PathValidationError.
   *
   * @throws PathValidationError with code "SYMLINK_ESCAPE" if file escapes worktree
   */
  async readFileBuffer(worktreePath: string, filePath: string): Promise<Buffer> {
    assertRegisteredWorktree(worktreePath)
    const fullPath = resolvePathInWorktree(worktreePath, filePath)

    // Block reads through symlinks that escape the worktree
    await assertRealpathInWorktree(worktreePath, fullPath)

    return readFile(fullPath)
  },

  /**
   * Write content to a file within a worktree.
   *
   * SECURITY: Blocks writes if the file is a symlink pointing outside
   * the worktree. This prevents malicious repos from tricking users
   * into overwriting sensitive files like ~/.bashrc.
   *
   * @throws PathValidationError with code "SYMLINK_ESCAPE" if target escapes worktree
   */
  async writeFile(worktreePath: string, filePath: string, content: string): Promise<void> {
    assertRegisteredWorktree(worktreePath)
    const fullPath = resolvePathInWorktree(worktreePath, filePath)

    // Block writes through symlinks that escape the worktree
    await assertRealpathInWorktree(worktreePath, fullPath)

    await writeFile(fullPath, content, "utf-8")
  },

  /**
   * Delete a file or directory within a worktree.
   *
   * SECURITY: Validates the real path is within worktree before deletion.
   * - Symlinks: Deletes the link itself (safe - link lives in worktree)
   * - Files/dirs: Validates realpath then deletes
   *
   * This prevents symlink escape attacks where a malicious repo contains
   * `docs -> /Users/victim` and a delete of `docs/file` would delete
   * `/Users/victim/file`.
   */
  async delete(worktreePath: string, filePath: string): Promise<void> {
    assertRegisteredWorktree(worktreePath)
    // allowRoot: false prevents deleting the worktree itself
    const fullPath = resolvePathInWorktree(worktreePath, filePath, {
      allowRoot: false,
    })

    let stats: Stats
    try {
      stats = await lstat(fullPath)
    } catch (error) {
      // File doesn't exist - idempotent delete, nothing to do
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return
      }
      throw error
    }

    if (stats.isSymbolicLink()) {
      // Symlink - safe to delete the link itself (it lives in the worktree).
      // Don't use recursive as we're just removing the symlink file.
      await rm(fullPath)
      return
    }

    // Regular file or directory - validate realpath is within worktree.
    // This catches path traversal via symlinked parent components:
    // e.g., `docs -> /victim`, delete `docs/file` → realpath is `/victim/file`
    await assertRealpathInWorktree(worktreePath, fullPath)

    // Safe to delete - realpath confirmed within worktree.
    // Note: Symlinks INSIDE a directory are safe - rm deletes the links, not targets.
    await rm(fullPath, { recursive: true, force: true })
  },

  /**
   * Get file stats within a worktree.
   *
   * Uses `stat` (follows symlinks) to get the real file size.
   * Validates that the resolved path stays within the worktree boundary.
   */
  async stat(worktreePath: string, filePath: string): Promise<Stats> {
    assertRegisteredWorktree(worktreePath)
    const fullPath = resolvePathInWorktree(worktreePath, filePath)
    await assertRealpathInWorktree(worktreePath, fullPath)
    return stat(fullPath)
  },

  /**
   * Get file stats without following symlinks.
   *
   * Use this when you need to know if something IS a symlink.
   * For size checks, prefer `stat` instead.
   */
  async lstat(worktreePath: string, filePath: string): Promise<Stats> {
    assertRegisteredWorktree(worktreePath)
    const fullPath = resolvePathInWorktree(worktreePath, filePath)
    return lstat(fullPath)
  },

  /**
   * Check if a file exists within a worktree.
   *
   * Returns false for non-existent files, symlink escapes, and validation failures.
   */
  async exists(worktreePath: string, filePath: string): Promise<boolean> {
    try {
      assertRegisteredWorktree(worktreePath)
      const fullPath = resolvePathInWorktree(worktreePath, filePath)
      await assertRealpathInWorktree(worktreePath, fullPath)
      await stat(fullPath)
      return true
    } catch {
      return false
    }
  },

  /**
   * Check if a file is a symlink that points outside the worktree.
   *
   * WARNING: This is a best-effort helper for UI warnings only.
   * It returns `false` on errors, so it is NOT suitable as a security gate.
   * For security enforcement, use the read/write methods which call
   * assertRealpathInWorktree internally.
   *
   * @returns true if the file is definitely a symlink escaping the worktree,
   *          false if not escaping OR if we can't determine (errors)
   */
  async isSymlinkEscaping(worktreePath: string, filePath: string): Promise<boolean> {
    try {
      assertRegisteredWorktree(worktreePath)
      const fullPath = resolvePathInWorktree(worktreePath, filePath)

      // Check if it's a symlink first
      const stats = await lstat(fullPath)
      if (!stats.isSymbolicLink()) {
        return false
      }

      // Check if realpath escapes worktree
      const real = await realpath(fullPath)
      const worktreeReal = await realpath(worktreePath)

      return !isPathWithinWorktree(worktreeReal, real)
    } catch {
      // If we can't determine, assume not escaping (file may not exist)
      // NOTE: This makes this method unsuitable as a security gate
      return false
    }
  },
}
