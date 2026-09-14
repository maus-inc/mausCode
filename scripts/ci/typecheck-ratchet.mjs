#!/usr/bin/env node
/**
 * Typecheck ratchet, the blocking typecheck gate in the CI quality job.
 *
 * Compares the current `tsc --noEmit` error set against the recorded
 * baseline and fails on regressions. The baseline file,
 * `.github/ci-baselines/typecheck.txt`, is empty, so zero errors is the
 * gate and any error fails. When the tree improves, commit the smaller
 * baseline with --update.
 *
 * Keys are `relative/path.ts|TS####` (line numbers excluded on purpose, they
 * shift as files are edited). Multiplicity is preserved by the multiset
 * comparison below.
 *
 * Usage:
 *   node scripts/ci/typecheck-ratchet.mjs            # check against baseline
 *   node scripts/ci/typecheck-ratchet.mjs --update   # regenerate baseline
 *   node scripts/ci/typecheck-ratchet.mjs --report   # print counts only
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const BASELINE = join(ROOT, ".github", "ci-baselines", "typecheck.txt")

const ERROR_RE = /^(.+?)\(\d+,\d+\): error (TS\d+):/

function runTsc() {
  try {
    // tsc exits non-zero when errors exist; that is the normal path here.
    return execFileSync("npx", ["tsc", "--noEmit"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    // tsc exits 1 or 2 when diagnostics exist (TS version dependent);
    // either is fine as long as diagnostics were printed.
    if ((error.status === 1 || error.status === 2) && (error.stdout || error.stderr)) {
      return `${error.stdout ?? ""}${error.stderr ?? ""}`
    }
    console.error("tsc failed to run:", error.message)
    process.exit(2)
  }
}

function collectKeys(output) {
  /** @type {Map<string, number>} path|code -> count */
  const counts = new Map()
  for (const line of output.split("\n")) {
    const match = line.match(ERROR_RE)
    if (!match) continue
    const rel = relative(ROOT, join(ROOT, match[1])).replaceAll("\\", "/")
    const key = `${rel}|${match[2]}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function serialize(counts) {
  const lines = []
  for (const [key, count] of [...counts.entries()].sort()) {
    for (let i = 0; i < count; i++) lines.push(key)
  }
  return `${lines.join("\n")}\n`
}

function totalOf(counts) {
  let total = 0
  for (const count of counts.values()) total += count
  return total
}

const mode = process.argv[2] ?? "--check"
const current = collectKeys(runTsc())
const currentTotal = totalOf(current)

if (mode === "--report") {
  console.log(`current type errors: ${currentTotal}`)
  process.exit(0)
}

if (mode === "--update") {
  writeFileSync(BASELINE, serialize(current))
  console.log(`baseline updated: ${currentTotal} errors -> ${relative(ROOT, BASELINE)}`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error(`baseline not found: ${relative(ROOT, BASELINE)}`)
  console.error("run 'node scripts/ci/typecheck-ratchet.mjs --update' to create it")
  process.exit(2)
}

const baseline = collectKeys(
  readFileSync(BASELINE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((key) => {
      // Reuse the key parser by faking tsc output lines.
      return `(${key})`
    })
    .join("\n")
    .replace(/\((.+?)\|(TS\d+)\)/g, "$1(0,0): error $2:"),
)
const baselineTotal = totalOf(baseline)

const regressions = []
for (const [key, count] of current) {
  const allowed = baseline.get(key) ?? 0
  if (count > allowed) {
    regressions.push(`${key}: ${count - allowed} new error(s)`)
  }
}

if (regressions.length > 0) {
  console.error(
    `typecheck ratchet failed: ${regressions.length} new error class(es), ` +
      `${currentTotal} total vs ${baselineTotal} baseline:`,
  )
  for (const line of regressions) console.error(`  ${line}`)
  process.exit(1)
}

console.log(`typecheck ratchet passed: ${currentTotal} errors <= ${baselineTotal} baseline`)
if (currentTotal < baselineTotal) {
  console.log(
    `baseline improved by ${baselineTotal - currentTotal}; run ` +
      "'node scripts/ci/typecheck-ratchet.mjs --update' and commit the smaller baseline",
  )
}
