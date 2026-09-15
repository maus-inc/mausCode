#!/usr/bin/env node
/**
 * Lint changed files with Biome, tolerating an empty change set.
 *
 * `biome ci --changed` compares commits, so it sees nothing for uncommitted
 * local work, and exits 1 when a PR only touches non-lintable files. This
 * wrapper computes the file list explicitly (committed range plus working
 * tree) and skips the run when nothing lintable changed.
 *
 * A base that this clone cannot resolve falls back to origin/main, and then to
 * the whole tree, so a rewritten branch fails on a real finding instead of on a
 * missing commit. The base is taken as the sha (full or unique prefix) of a
 * commit this clone already has, and the sha that reaches the diffs comes from
 * git's own commit list, so an externally supplied string never reaches a git
 * argument list.
 *
 * Usage:
 *   node scripts/ci/lint-changed.mjs [sha]   # default: merge-base of origin/main
 *   LINT_BASE=<sha> node scripts/ci/lint-changed.mjs
 */
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const LINTABLE = /\.(js|jsx|ts|tsx|mjs|mts|cjs|cts|json|jsonc|css|graphql)$/i

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
}

const OBJECT_ID = /^[0-9a-f]{4,40}$/

let commitIds = null

function localCommitIds() {
  try {
    return git(["rev-list", "--all"]).split("\n").filter(Boolean)
  } catch {
    return []
  }
}

// Resolves a caller-supplied base without ever passing it to git as an
// argument: the string is matched against the ids git printed for the local
// commits, and the match, not the caller's text, is what the diffs below use.
// Handing an externally supplied string to a CLI argument list is what
// jssecurity:S8705 reports, and a git argument here can be a file write
// (`diff --output=`). A prefix is accepted when it is unique, matching the
// behaviour of an abbreviated sha, and anything unresolvable is null, which
// widens the diff rather than crashing the gate.
function knownCommit(value) {
  const candidate = value.trim()
  if (!OBJECT_ID.test(candidate)) return null
  commitIds ??= localCommitIds()
  const matches = commitIds.filter((id) => id.startsWith(candidate))
  return matches.length === 1 ? matches[0] : null
}

function resolves(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

// A force push leaves the previous head unreachable, so the commit the workflow
// passes as LINT_BASE is often absent from the clone.
function resolveBase() {
  const supplied = (process.argv[2] ?? process.env.LINT_BASE ?? "").trim()
  if (supplied !== "") {
    const commit = knownCommit(supplied)
    if (commit !== null) return commit
    const reason = OBJECT_ID.test(supplied)
      ? "is not a commit in this clone, usually a rewritten branch"
      : "is not a sha, and only sha bases are accepted"
    console.log(`lint-changed: base ${supplied} ${reason}; falling back`)
  }
  if (!resolves("origin/main")) return null
  try {
    return git(["merge-base", "origin/main", "HEAD"])
  } catch {
    // No shared history with origin/main (independent roots): diff against
    // its tip. changedSinceBase degrades three-dot to two-dot for this.
    return "origin/main"
  }
}

const base = resolveBase()

// A shallow clone, or a branch whose history does not reach origin/main's
// tip, can have no merge base, so a three-dot diff is not always available.
// Fall back to an endpoint (two-dot) diff, which works regardless.
function changedSinceBase(base) {
  try {
    return git(["diff", "--name-only", "--diff-filter=ACMR", "--end-of-options", `${base}...HEAD`])
  } catch {
    return git(["diff", "--name-only", "--diff-filter=ACMR", "--end-of-options", `${base}..HEAD`])
  }
}

const changed = new Set()
if (base !== null) {
  for (const output of [
    changedSinceBase(base),
    git(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]), // uncommitted work
    git(["ls-files", "--others", "--exclude-standard"]), // untracked new files
  ]) {
    for (const file of output.split("\n").filter(Boolean)) changed.add(file)
  }
}

const files = base === null ? ["."] : [...changed].filter((file) => LINTABLE.test(file))

if (base === null) {
  console.log("lint-changed: no base ref resolves here; checking the whole tree")
} else if (files.length === 0) {
  console.log("lint-changed: no lintable files changed; skipping")
  process.exit(0)
} else {
  console.log(`lint-changed: checking ${files.length} file(s) since ${base}`)
}

try {
  execFileSync("bun", ["x", "biome", "ci", ...files], {
    cwd: ROOT,
    stdio: "inherit",
  })
} catch (error) {
  process.exit(error.status ?? 1)
}
