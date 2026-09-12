#!/usr/bin/env node
/**
 * lint-ratchet: fail only on biome diagnostics that touch lines this change ADDS.
 *
 * The file-level gate (lint-changed.mjs) works for small diffs but explodes on
 * large ones: a merge that touches 700 files surfaces thousands of pre-existing
 * findings (mostly warn-level debt like `any` in old code) and can never go
 * green without churning code the change doesn't own. This keeps the original
 * intent ("gate only what the change touches", see the CI workflow comment) at
 * line granularity: added lines must be clean, untouched lines are grandfathered.
 *
 * Matches the ratchet philosophy of the sibling gates (ratchet:typecheck,
 * ratchet:audit): no NEW issues, old debt paid down separately.
 *
 * Usage:
 *   node scripts/ci/lint-ratchet.mjs [base-ref]   # default: merge-base of origin/main
 *   LINT_BASE=<sha> node scripts/ci/lint-ratchet.mjs
 */
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const LINTABLE = /\.(js|jsx|ts|tsx|mjs|mts|cjs|cts|json|jsonc|css|graphql)$/i

function git(args) {
  // Large diffs (whole-tree on unrelated histories) exceed the 1MB default.
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim()
}

function resolveBase() {
  const explicit = process.argv[2] ?? process.env.LINT_BASE
  if (explicit) return explicit
  try {
    return git(["merge-base", "origin/main", "HEAD"])
  } catch {
    // No shared history with origin/main (independent roots): diff against
    // its tip directly.
    return git(["rev-parse", "origin/main"])
  }
}

// addedRanges: Map<path, Array<[start, endExclusive]>> (1-based new-file lines)
function parseUnifiedZero(diffText, addedRanges) {
  let current = null
  for (const line of diffText.split("\n")) {
    const header = line.match(/^diff --git (?:a\/|"a\/)(.+?)(?:" b\/| b\/)/)
    if (header) {
      // b-side path: strip leading "b/" from the remainder after " b/".
      const rest = line.slice(line.indexOf(header[0]) + header[0].length)
      current = rest.replace(/^b\//, "").replace(/^"|"$/g, "")
      if (!addedRanges.has(current)) addedRanges.set(current, [])
      continue
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunk && current) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      if (count > 0) addedRanges.get(current).push([start, start + count])
    }
  }
}

const base = resolveBase()
const addedRanges = new Map()

// Unified base-to-worktree diff: a single coordinate space (current file
// lines). Splitting committed + worktree diffs would misalign committed
// hunk positions (HEAD coordinates) against current-file finding lines.
// LINT_INCLUDE_WORKTREE=0 diffs against HEAD instead (CI-equivalent local run).
if (process.env.LINT_INCLUDE_WORKTREE !== "0") {
  parseUnifiedZero(git(["diff", "-U0", "--diff-filter=ACMR", base]), addedRanges)
} else {
  parseUnifiedZero(git(["diff", "-U0", "--diff-filter=ACMR", base, "HEAD"]), addedRanges)
}
// 3. Untracked files: every line is new. (CI checks out clean, so there are
// none there; set LINT_INCLUDE_UNTRACKED=0 for a CI-equivalent local run
// when the worktree has scratch files.)
const untrackedAll = new Set(
  process.env.LINT_INCLUDE_UNTRACKED === "0"
    ? []
    : git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean),
)

const files = new Set()
for (const path of addedRanges.keys()) files.add(path)
for (const path of untrackedAll) files.add(path)
const lintable = [...files].filter((file) => LINTABLE.test(file))

if (lintable.length === 0) {
  console.log("lint-ratchet: no lintable files changed; skipping")
  process.exit(0)
}

console.log(`lint-ratchet: checking ${lintable.length} file(s) since ${base}`)

let raw
try {
  raw = execFileSync(
    "bun",
    ["x", "biome", "ci", "--reporter=json", "--max-diagnostics=none", ...lintable],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  )
} catch (error) {
  // biome exits nonzero when it reports anything; the JSON is still on stdout.
  raw = error.stdout ?? ""
}
const clean = String(raw).replace(/\x1b\[[0-9;]*m/g, "")
let report
try {
  report = JSON.parse(clean.slice(clean.indexOf("{")))
} catch {
  console.error("lint-ratchet: could not parse biome JSON output")
  process.exit(2)
}

function isNewLocation(path, startLine, endLine) {
  if (untrackedAll.has(path)) return true
  const ranges = addedRanges.get(path) ?? []
  return ranges.some(([from, to]) => startLine < to && endLine >= from)
}

const fresh = []
let grandfathered = 0
for (const diag of report.diagnostics ?? []) {
  if (diag.severity !== "error" && diag.severity !== "warning") continue
  const path = diag.location?.path
  const startLine = diag.location?.start?.line ?? 0
  const endLine = diag.location?.end?.line ?? startLine
  if (!path) continue
  if (isNewLocation(path, startLine, endLine)) {
    fresh.push(
      `${path}:${startLine}:${diag.location?.start?.column ?? 0} [${diag.severity}] ${diag.category}: ${diag.message}`,
    )
  } else {
    grandfathered += 1
  }
}

if (fresh.length > 0) {
  console.log(`\nlint-ratchet: ${fresh.length} NEW finding(s) on added lines:\n`)
  for (const finding of fresh) console.log(`  ${finding}`)
  console.log(`\n(${grandfathered} pre-existing finding(s) on untouched lines grandfathered.)`)
  process.exit(1)
}

console.log(
  `lint-ratchet: clean — 0 new findings (${grandfathered} pre-existing grandfathered across ${lintable.length} files)`,
)
