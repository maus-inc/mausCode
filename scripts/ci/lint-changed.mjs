#!/usr/bin/env node
/**
 * Lint changed files with Biome, tolerating an empty change set.
 *
 * `biome ci --changed` compares commits, so it sees nothing for uncommitted
 * local work, and exits 1 when a PR only touches non-lintable files. This
 * wrapper computes the file list explicitly (committed range plus working
 * tree) and skips the run when nothing lintable changed.
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

function resolveBase() {
  const explicit = process.argv[2] ?? process.env.LINT_BASE
  if (explicit) return explicit
  try {
    return git(["merge-base", "origin/main", "HEAD"])
  } catch {
    return "HEAD~1"
  }
}

const base = resolveBase()

const changed = new Set()
for (const args of [
  ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`],
  ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], // uncommitted work
  ["ls-files", "--others", "--exclude-standard"], // untracked new files
]) {
  for (const file of git(args).split("\n").filter(Boolean)) changed.add(file)
}

const files = [...changed].filter((file) => LINTABLE.test(file))

if (files.length === 0) {
  console.log("lint-changed: no lintable files changed; skipping")
  process.exit(0)
}

console.log(`lint-changed: checking ${files.length} file(s) since ${base}`)
try {
  execFileSync("bun", ["x", "biome", "ci", "--error-on-warnings", ...files], {
    cwd: ROOT,
    stdio: "inherit",
  })
} catch (error) {
  process.exit(error.status ?? 1)
}
