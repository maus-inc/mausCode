#!/usr/bin/env node

/**
 * Dependency-audit ratchet — blocks NEW critical advisories.
 *
 * Baseline (initial): empty, so zero critical advisories is the gate.
 * Gating the full tree on `bun audit` today would block all work; this
 * script fails only when an advisory at or above the gate severity appears
 * that is not in the recorded baseline.
 *
 * Usage:
 *   node scripts/ci/audit-ratchet.mjs            # check against baseline
 *   node scripts/ci/audit-ratchet.mjs --update   # regenerate baseline
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const BASELINE = join(ROOT, ".github", "ci-baselines", "audit-critical.txt")
const GATE_SEVERITIES = new Set(["critical"])

function runAudit() {
  try {
    const output = execFileSync("bun", ["audit", "--json"], {
      cwd: ROOT,
      env: { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
    return JSON.parse(output)
  } catch (e) {
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout.toString())
      } catch {
        /* fall through */
      }
    }
    console.error("Failed to run bun audit:", e.message)
    process.exit(1)
  }
}

function main() {
  const args = process.argv.slice(2)
  const audit = runAudit()

  const critical = (audit.advisories || []).filter(
    (a) => a.severity && GATE_SEVERITIES.has(a.severity),
  )

  if (args.includes("--update")) {
    writeFileSync(BASELINE, critical.map((a) => `${a.module}|${a.url}`).join("\n") + (critical.length ? "\n" : ""))
    console.log(`Audit baseline updated: ${critical.length} critical advisory(ies) recorded.`)
    process.exit(0)
  }

  if (!existsSync(BASELINE)) {
    console.error("No baseline found. Run with --update to create one.")
    process.exit(1)
  }

  const baseline = readFileSync(BASELINE, "utf8").split("\n").filter(Boolean)
  const baselineSet = new Set(baseline)
  const newCritical = critical.filter((a) => !baselineSet.has(`${a.module}|${a.url}`))

  if (newCritical.length > 0) {
    console.error(`Audit ratchet: ${newCritical.length} new critical advisory(ies):`)
    newCritical.forEach((a) => console.error(`  ${a.module}: ${a.title} (${a.url})`))
    process.exit(1)
  }

  console.log(`Audit ratchet: passed (${critical.length} total critical, ${newCritical.length} new).`)
}

main()
