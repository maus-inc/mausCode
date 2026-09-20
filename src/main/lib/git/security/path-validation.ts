import { eq } from "drizzle-orm"
import { chats, getDatabase, projects } from "../../db"
import { PathValidationError } from "./errors"

export {
  assertToolPathInWorktree,
  assertValidGitPath,
  resolvePathInWorktree,
  type ValidatePathOptions,
  validateRelativePath,
} from "./containment"
// The error type and the containment checks live in dependency-free modules so
// a test can import them without loading the database. Re-exported here because
// this file is where callers have always found them.
export { PathValidationError, type PathValidationErrorCode } from "./errors"

/**
 * Security model for desktop app filesystem access:
 *
 * THREAT MODEL:
 * While a compromised renderer can execute commands via terminal panes,
 * the File Viewer presents a distinct threat: malicious repositories can
 * contain symlinks that trick users into reading/writing sensitive files
 * (e.g., `docs/config.yml` → `~/.bashrc`). Users clicking these links
 * don't know they're accessing files outside the repo.
 *
 * PRIMARY BOUNDARY: assertRegisteredWorktree()
 * - Only worktree paths registered in localDb are accessible via tRPC
 * - Prevents direct filesystem access to unregistered paths
 *
 * SECONDARY: validateRelativePath()
 * - Rejects absolute paths and ".." traversal segments
 * - Defense in depth against path manipulation
 *
 * SYMLINK PROTECTION (secure-fs.ts):
 * - Writes: Block if realpath escapes worktree (prevents accidental overwrites)
 * - Reads: Caller can check isSymlinkEscaping() to warn users
 */

/**
 * Validates that a workspace path is registered in database.
 * This is THE critical security boundary.
 *
 * Accepts:
 * - Worktree paths (from chats.worktreePath)
 * - Project paths (from projects.path)
 *
 * @throws PathValidationError if path is not registered
 */
export function assertRegisteredWorktree(workspacePath: string): void {
  const db = getDatabase()

  // Check chats.worktreePath first (most common case)
  const chatExists = db.select().from(chats).where(eq(chats.worktreePath, workspacePath)).get()

  if (chatExists) {
    return
  }

  // Check projects.path for direct project access
  const projectExists = db.select().from(projects).where(eq(projects.path, workspacePath)).get()

  if (projectExists) {
    return
  }

  throw new PathValidationError(
    "Workspace path not registered in database",
    "UNREGISTERED_WORKTREE",
  )
}

/**
 * Gets the chat record if registered. Returns record for updates.
 *
 * @throws PathValidationError if chat is not registered
 */
export function getRegisteredChat(worktreePath: string): typeof chats.$inferSelect {
  const db = getDatabase()
  const chat = db.select().from(chats).where(eq(chats.worktreePath, worktreePath)).get()

  if (!chat) {
    throw new PathValidationError("Chat not registered in database", "UNREGISTERED_WORKTREE")
  }

  return chat
}
