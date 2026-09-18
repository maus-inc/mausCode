/**
 * The error every path check in this module throws, and the codes it carries.
 *
 * Its own file because it has no dependencies: `path-validation.ts` reaches the
 * database, and the containment checks must stay importable from a test that
 * cannot load `electron` or a native `better-sqlite3` binding.
 */

/**
 * Security error codes for path validation failures.
 */
export type PathValidationErrorCode =
  | "ABSOLUTE_PATH"
  | "PATH_TRAVERSAL"
  | "UNREGISTERED_WORKTREE"
  | "INVALID_TARGET"
  | "SYMLINK_ESCAPE"

/**
 * Error thrown when path validation fails.
 * Includes a code for programmatic handling.
 */
export class PathValidationError extends Error {
  constructor(
    message: string,
    public readonly code: PathValidationErrorCode,
  ) {
    super(message)
    this.name = "PathValidationError"
  }
}
