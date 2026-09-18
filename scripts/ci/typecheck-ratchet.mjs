#!/usr/bin/env node

/**
 * Typecheck ratchet — blocks NEW type errors.
 *
 * Baseline is `.github/ci-baselines/typecheck.txt` (empty on first run,
 * so zero errors is the gate). When the tree improves, commit the smaller
 * baseline with --update.
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
    const output = execFileSync("npx", ["tsc", "--noEmit"], {
      cwd: ROOT,
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
    return { output, errors: [] }
  } catch (e) {
    return { output: e.stdout || "", errors: e.stderr ? e.stderr.split("\n").filter(Boolean) : [] }
  }
}

function parseErrors(output) {
  const errors = []
  for (const line of output.split("\n")) {
    const match = ERROR_RE.exec(line)
    if (match) {
      errors.push(`${relative(ROOT, match[1])}|${match[2]}`)
    }
  }
  return errors
}

function main() {
  const args = new Set(process.argv.slice(2))

  if (args.has("--report")) {
    const { output } = runTsc()
    const errors = parseErrors(output)
    console.log(`TypeScript errors: ${errors.length}`)
    process.exit(0)
  }

  if (args.has("--update")) {
    const { output } = runTsc()
    const errors = parseErrors(output)
    writeFileSync(BASELINE, errors.join("\n") + (errors.length ? "\n" : ""))
    console.log(`Baseline updated: ${errors.length} error(s) recorded.`)
    process.exit(0)
  }

  const { output } = runTsc()
  const currentErrors = parseErrors(output)

  if (!existsSync(BASELINE)) {
    console.error("No baseline found. Run with --update to create one.")
    process.exit(1)
  }

  const baseline = readFileSync(BASELINE, "utf8").split("\n").filter(Boolean)
  const baselineSet = new Set(baseline)
  const newErrors = currentErrors.filter((e) => !baselineSet.has(e))

  if (newErrors.length > 0) {
    console.error(`Typecheck ratchet: ${newErrors.length} new error(s) found:`)
    newErrors.forEach((e) => console.error(`  ${e}`))
    process.exit(1)
  }

  console.log(`Typecheck ratchet: passed (${currentErrors.length} total, ${newErrors.length} new).`)
}

main()
