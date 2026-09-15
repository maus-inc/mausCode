#!/usr/bin/env node
/**
 * Lint changed files with Biome, tolerating an empty change set.
 *
 * `biome ci --changed` compares commits, so it sees nothing for uncommitted
 * local work, and exits 1 when a PR only touches non-lintable files. This
 * wrapper computes the file list explicitly (committed range plus working
 * tree) and skips the run when nothing lintable changed.
 *
 * A base-ref that this clone cannot resolve falls back to origin/main, and then
 * to the whole tree, so a rewritten branch fails on a real finding instead of
 * on a missing commit.
 *
 * Usage:
 *   node scripts/ci/lint-changed.mjs [base-ref]   # default: merge-base of origin/main
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

function resolves(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

// A force push leaves the previous head unreachable, so the ref the workflow
// passes as LINT_BASE is often absent from the clone.
function resolveBase() {
  const explicit = process.argv[2] ?? process.env.LINT_BASE
  if (explicit && resolves(explicit)) return explicit
  if (explicit) {
    console.log(
      `lint-changed: base ${explicit} is not in this clone, usually a rewritten branch; falling back`,
    )
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

// This repo's branches do not all share history (e.g. `init` and `main` are
// independent roots), so a three-dot diff can have no merge base. Fall back to
// an endpoint (two-dot) diff, which works for unrelated trees.
function changedSinceBase(base) {
  try {
    return git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
  } catch {
    return git(["diff", "--name-only", "--diff-filter=ACMR", `${base}..HEAD`])
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
