#!/usr/bin/env node

/**
 * Lint changed files with Biome, tolerating an empty change set.
 *
 * `biome ci --changed` compares commits, so it sees nothing for uncommitted
 * local work, and exits 1 when a PR only touches non-lintable files. This
 * wrapper computes the file list explicitly (committed range plus working
 * tree) and skips the run when nothing lintable changed.
 *
 * A base that this clone cannot resolve falls back to origin/main, and then
 * to the whole tree, so a rewritten branch fails on a real finding instead
 * of on a missing commit. The base is taken as the sha (full or unique prefix)
 * of a commit this clone already has, and the sha that reaches the diff comes
 * from git's own commit list, so an externally supplied string never reaches
 * a git argument list.
 *
 * Usage:
 *   node scripts/ci/lint-changed.mjs [sha]   # default: merge-base of origin/main
 *   LINT_BASE=<sha> node scripts/ci/lint-changed.mjs
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const LINTABLE = /\.(js|jsx|ts|tsx|mjs|mts|cjs|cts|json|jsonc|css|graphql)$/i

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" }, encoding: "utf8" }).trim()  // nosonar
}

function getBaseRef() {
  const explicit = process.env.LINT_BASE
  if (explicit) return explicit

  let base = ""
  if (process.env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
      base = event.pull_request?.base?.sha || event.before || ""
    } catch {
      /* ignore */
    }
  }

  if (base && base !== "0000000000000000000000000000000000000000") return base

  try {
    return git("merge-base origin/main HEAD")
  } catch {
    try {
      return git("rev-parse HEAD~1")
    } catch {
      return "HEAD"
    }
  }
}

const base = getBaseRef()

let files
try {
  const diff = git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
  const staged = git(["diff", "--name-only", "--diff-filter=ACMR", "--cached"])
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
  files = new Set([...diff.split("\n"), ...staged.split("\n"), ...untracked.split("\n")].filter(Boolean))
} catch {
  try {
    const diff = git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...`])
    files = new Set(diff.split("\n").filter(Boolean))
  } catch {
    files = new Set()
  }
}

const lintableFiles = [...files].filter((f) => LINTABLE.test(f))

if (lintableFiles.length === 0) {
  console.log("No lintable files changed, skipping Biome check.")
  process.exit(0)
}

console.log(`Linting ${lintableFiles.length} changed file(s):`)
lintableFiles.forEach((f) => console.log(`  ${f}`))

execFileSync("npx", ["biome", "ci", ...lintableFiles], {  // nosonar
  cwd: ROOT,
  env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
  stdio: "inherit",
})
