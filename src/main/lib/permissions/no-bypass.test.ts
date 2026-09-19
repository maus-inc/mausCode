/**
 * The acceptance criterion from roadmap step 10 section 10, as a test rather
 * than as a grep a reviewer has to remember to run:
 *
 *   `grep -rn "bypassPermissions\|allowDangerouslySkipPermissions" src` returns
 *   nothing outside tests that assert its absence, and nothing at all in a
 *   router.
 *
 * Both spellings are the SDK's permission bypass. `AGENTS.md` section 8 lists
 * them under Never, and the porting recipe calls `bypassPermissions` never
 * portable, so a hit anywhere in shipped source is a regression this file
 * fails on. Documentation that names the posture is allowed to describe it in
 * prose; the tokens themselves stay in tests.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const FORBIDDEN = ["bypassPermissions", "allowDangerouslySkipPermissions"]

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

function sourceFiles(root: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path))
      continue
    }
    if (!/\.(ts|tsx|mts|cts|js|mjs|json)$/.test(entry)) continue
    found.push(path)
  }
  return found
}

interface Hit {
  file: string
  line: number
  token: string
}

function findHits(files: string[]): Hit[] {
  const hits: Hit[] = []
  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n")
    lines.forEach((text, index) => {
      for (const token of FORBIDDEN) {
        if (text.includes(token)) {
          hits.push({ file: relative(SRC_ROOT, file), line: index + 1, token })
        }
      }
    })
  }
  return hits
}

function describeHits(hits: Hit[]): string {
  return hits.map((hit) => `${hit.file}:${hit.line} ${hit.token}`).join("\n")
}

describe("no permission bypass in src", () => {
  it("finds the tokens only in tests that assert their absence", () => {
    const hits = findHits(sourceFiles(SRC_ROOT))
    const outsideTests = hits.filter((hit) => !hit.file.endsWith(".test.ts"))
    expect(describeHits(outsideTests)).toBe("")
  })

  it("finds nothing at all in a router, test files included", () => {
    const hits = findHits(sourceFiles(join(SRC_ROOT, "main/lib/trpc/routers")))
    expect(describeHits(hits)).toBe("")
  })

  it("still finds the tokens somewhere, so the walk is not silently empty", () => {
    // A guard against this test passing because the walk broke: the grok argv
    // test asserts the absence of the bypass spellings, so it must contain one.
    const hits = findHits(sourceFiles(join(SRC_ROOT, "main/lib/grok-print")))
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.file.endsWith(".test.ts"))).toBe(true)
  })
})
