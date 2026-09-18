/**
 * Wiring for the permission gate: the real policy file and the real path check,
 * injected into the evaluator.
 *
 * Everything this module reaches is dependency-free on purpose, so a test can
 * import the wired gate and exercise it against a real temporary directory.
 * `../git/security/containment` is imported as a leaf rather than through the
 * `../git/security` barrel because that barrel also exports the
 * database-registered worktree checks, which pull `electron` and a native
 * `better-sqlite3` binding that CI's `--ignore-scripts` install does not build.
 * Those checks are a tRPC-file-endpoint boundary; the run's own cwd is already
 * the workspace the app chose, so the gate does not need them.
 */
import { assertToolPathInWorktree } from "../git/security/containment"
import { PathValidationError } from "../git/security/errors"
import { createPermissionEvaluator, type PathCheck } from "./evaluator"
import {
  describeError,
  invalidatePolicyCache,
  permissionsPolicyPath,
  readPolicyFile,
} from "./policy-file"

async function checkToolPath(worktreePath: string, candidatePath: string): Promise<PathCheck> {
  try {
    return { ok: true, relative: await assertToolPathInWorktree(worktreePath, candidatePath) }
  } catch (error) {
    if (error instanceof PathValidationError) {
      return { ok: false, code: error.code, message: error.message }
    }
    // Fail closed on anything the validator did not name, and say so.
    return { ok: false, code: "SYMLINK_ESCAPE", message: describeError(error) }
  }
}

export const { evaluateAction } = createPermissionEvaluator({
  loadPolicy: () => readPolicyFile(),
  checkPath: checkToolPath,
})

export type { PathCheck, PermissionAction, PermissionEvaluatorDeps } from "./evaluator"
export type { LoadedPolicy } from "./policy-file"
export { invalidatePolicyCache, permissionsPolicyPath }
