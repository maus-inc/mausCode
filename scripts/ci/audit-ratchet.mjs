#!/usr/bin/env node
/**
 * Dependency-audit ratchet — blocks NEW critical advisories.
 *
 * Baseline (2026-09-11): 229 advisories, 3 critical (protobufjs, simple-git,
 * node-tar transitives). Gating the full tree on `bun audit` today would block
 * all work; this script fails only when an advisory at or above the gate
 * severity appears that is not in the recorded baseline. Severity gate moves
 * critical -> high once the tree is remediated (see .dump/ci/plans).
 *
 * Usage:
 *   node scripts/ci/audit-ratchet.mjs            # check against baseline
 *   node scripts/ci/audit-ratchet.mjs --update   # regenerate baseline
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const BASELINE = join(ROOT, ".github", "ci-baselines", "audit-critical.txt")
const GATE_SEVERITIES = ["critical"]

function runAudit() {
  try {
    const output = execFileSync("bun", ["audit", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
    return JSON.parse(output)
  } catch (error) {
    // bun audit exits 1 when vulnerabilities exist; the JSON is still usable.
    if (error.status === 1 && error.stdout) {
      return JSON.parse(error.stdout)
    }
    console.error("bun audit failed to run:", error.message)
    process.exit(2)
  }
}

/** @returns {Map<string, string>} key (pkg|advisory-url) -> severity, gated */
function collectGated(report) {
  const keys = new Map()
  const severityOrder = ["low", "moderate", "high", "critical"]
  const gateFloor = Math.min(...GATE_SEVERITIES.map((s) => severityOrder.indexOf(s)))
  for (const [pkg, advisories] of Object.entries(report)) {
    for (const advisory of advisories) {
      if (severityOrder.indexOf(advisory.severity) >= gateFloor) {
        keys.set(`${pkg}|${advisory.url}`, advisory.severity)
      }
    }
  }
  return keys
}

function totals(report) {
  const counts = { critical: 0, high: 0, moderate: 0, low: 0 }
  for (const advisories of Object.values(report)) {
    for (const advisory of advisories) counts[advisory.severity]++
  }
  return counts
}

const report = runAudit()
const gate = GATE_SEVERITIES.join("+")
const currentTotals = totals(report)

if (process.argv[2] === "--update") {
  const gated = collectGated(report)
  writeFileSync(BASELINE, `${[...gated.keys()].sort().join("\n")}\n`)
  console.log(`baseline updated: ${gated.size} ${gate} advisories -> ${relative(ROOT, BASELINE)}`)
  process.exit(0)
}

console.log(
  `audit totals: ${currentTotals.critical} critical, ${currentTotals.high} high, ` +
    `${currentTotals.moderate} moderate, ${currentTotals.low} low (gate: ${gate})`,
)

if (!existsSync(BASELINE)) {
  console.error(`baseline not found: ${relative(ROOT, BASELINE)}`)
  console.error("run 'node scripts/ci/audit-ratchet.mjs --update' to create it")
  process.exit(2)
}

const baselineKeys = new Set(readFileSync(BASELINE, "utf8").split("\n").filter(Boolean))

const newAdvisories = []
for (const [key, severity] of collectGated(report)) {
  if (!baselineKeys.has(key)) newAdvisories.push(`  [${severity}] ${key}`)
}

if (newAdvisories.length > 0) {
  console.error(`audit ratchet failed: ${newAdvisories.length} new ${gate} advisory(ies):`)
  for (const line of newAdvisories) console.error(line)
  process.exit(1)
}

console.log(`audit ratchet passed: no new ${gate} advisories vs baseline`)
