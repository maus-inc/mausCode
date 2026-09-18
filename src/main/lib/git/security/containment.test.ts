/**
 * Containment tests for the path guard a provider tool call goes through.
 *
 * These import `./containment` and `./errors` as leaves, never the
 * `../security` barrel: the barrel also exports the database-registered
 * worktree checks, which pull `electron` and a native `better-sqlite3` binding
 * that CI's `--ignore-scripts` install does not build. The two leaves are
 * dependency-free on purpose, so the guard is testable here.
 *
 * FIXTURE DISCIPLINE. This file previously deleted the workspace. Its
 * `beforeEach` canonicalised a directory it had not created yet, so the hook
 * threw, a module-level path variable kept its `""` initial value, and
 * `afterEach` ran `rmSync(join("", ".."))`, which resolves to the parent of the
 * process cwd. The rules below are mandatory:
 *
 * 1. `mkdirSync` first, `realpathSync` after.
 * 2. Never derive a cleanup path from a variable a failed hook could leave
 *    empty. `tempRoot` is assigned from `mkdtempSync` before anything that can
 *    throw, and cleanup asserts it lives under the OS temp dir.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { assertToolPathInWorktree, isPathWithinWorktree } from "./containment"
import { PathValidationError } from "./errors"

let tempRoot = ""
let worktree = ""
let outside = ""

/** True when this run can create symlinks; false inside some containers. */
let symlinksWork = true

beforeEach(() => {
  // Assigned first: every later statement can throw, and cleanup must not
  // depend on any of them having succeeded.
  tempRoot = mkdtempSync(join(tmpdir(), "mauscode-containment-"))
  mkdirSync(join(tempRoot, "repo"), { recursive: true })
  mkdirSync(join(tempRoot, "outside"), { recursive: true })
  // Canonicalise only after the directories exist. On macOS `tmpdir()` is
  // itself under a symlink (`/var` → `/private/var`), so the guard's realpath
  // comparison needs the canonical form or every fixture path looks escaped.
  worktree = realpathSync(join(tempRoot, "repo"))
  outside = realpathSync(join(tempRoot, "outside"))

  mkdirSync(join(worktree, "src"), { recursive: true })
  writeFileSync(join(worktree, "src/a.ts"), "export const a = 1\n", "utf-8")
  writeFileSync(join(outside, "leak.txt"), "secret\n", "utf-8")

  try {
    symlinkSync(join(outside, "leak.txt"), join(worktree, "src/link-out.txt"))
    symlinkSync(join(outside, "sub"), join(worktree, "src/dir-out"))
    mkdirSync(join(outside, "sub"), { recursive: true })
    symlinkSync(join(worktree, "src/a.ts"), join(worktree, "src/link-in.ts"))
  } catch {
    // No symlink privilege here. The traversal cases below still run.
    symlinksWork = false
  }
})

afterEach(() => {
  if (tempRoot.length === 0) return
  expect(tempRoot.startsWith(tmpdir())).toBe(true)
  rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = ""
})

async function expectCode(candidatePath: string, code: string): Promise<PathValidationError> {
  try {
    await assertToolPathInWorktree(worktree, candidatePath)
  } catch (error) {
    expect(error).toBeInstanceOf(PathValidationError)
    expect((error as PathValidationError).code).toBe(code)
    return error as PathValidationError
  }
  throw new Error(`expected ${JSON.stringify(candidatePath)} to be rejected with ${code}`)
}

describe("paths inside the worktree", () => {
  it("accepts a relative path and answers it unchanged", async () => {
    expect(await assertToolPathInWorktree(worktree, "src/a.ts")).toBe("src/a.ts")
  })

  it("accepts an absolute path and answers it relative", async () => {
    const absolute = join(worktree, "src/a.ts")
    expect(await assertToolPathInWorktree(worktree, absolute)).toBe("src/a.ts")
  })

  it("normalises a relative path that stays inside", async () => {
    expect(await assertToolPathInWorktree(worktree, "src/../src/a.ts")).toBe("src/a.ts")
  })

  it("accepts a symlink whose target is inside", async (context) => {
    if (!symlinksWork) {
      context.skip()
      return
    }
    expect(await assertToolPathInWorktree(worktree, "src/link-in.ts")).toBe("src/link-in.ts")
  })
})

describe("traversal", () => {
  it("rejects a relative path that climbs out", async () => {
    await expectCode("../outside/leak.txt", "PATH_TRAVERSAL")
  })

  it("rejects an absolute path containing traversal", async () => {
    await expectCode(join(worktree, "../outside/leak.txt"), "PATH_TRAVERSAL")
  })

  it("rejects a deep climb to the filesystem root", async () => {
    await expectCode("src/../../../../../../etc/passwd", "PATH_TRAVERSAL")
  })

  it("rejects an empty path", async () => {
    await expectCode("   ", "INVALID_TARGET")
  })
})

describe("symlinks that escape", () => {
  it("rejects a file symlink pointing outside", async (context) => {
    if (!symlinksWork) {
      context.skip()
      return
    }
    await expectCode("src/link-out.txt", "SYMLINK_ESCAPE")
  })

  it("rejects a path under a directory symlink pointing outside", async (context) => {
    if (!symlinksWork) {
      context.skip()
      return
    }
    await expectCode("src/dir-out/nested.txt", "SYMLINK_ESCAPE")
  })

  it("rejects a symlinked directory reached through an absolute path", async (context) => {
    if (!symlinksWork) {
      context.skip()
      return
    }
    await expectCode(join(worktree, "src/dir-out/nested.txt"), "SYMLINK_ESCAPE")
  })
})

describe("isPathWithinWorktree", () => {
  it("is true for the worktree itself and for a child", () => {
    expect(isPathWithinWorktree(worktree, worktree)).toBe(true)
    expect(isPathWithinWorktree(worktree, join(worktree, "src/a.ts"))).toBe(true)
  })

  it("is false for a sibling and for a prefix that is not a directory", () => {
    expect(isPathWithinWorktree(worktree, outside)).toBe(false)
    // `${worktree}-other` starts with the worktree string but is a different
    // directory. A naive startsWith check would let it through.
    expect(isPathWithinWorktree(worktree, `${worktree}-other/a.ts`)).toBe(false)
  })
})
