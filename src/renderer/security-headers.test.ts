/**
 * Renderer security-header tests. The CSP meta tag and the mermaid config
 * are the two places renderer content policy lives; these assertions keep a
 * future edit from re-opening the holes quietly.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getMermaidConfig } from "./components/mermaid-config"

const rendererDir = fileURLToPath(new URL(".", import.meta.url))
const csp = readFileSync(join(rendererDir, "index.html"), "utf8").match(
  /Content-Security-Policy" content="([^"]+)"/,
)?.[1]

describe("renderer CSP", () => {
  it("exists", () => {
    expect(csp).toBeTruthy()
  })

  it("does not allow eval", () => {
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it("grants unpkg only the pinned react-scan artifact, never the bare domain", () => {
    expect(csp).not.toMatch(/https:\/\/unpkg\.com[\s;]/)
    expect(csp).toContain("https://unpkg.com/react-scan/dist/auto.global.js")
  })
})

describe("mermaid config", () => {
  it("runs diagrams at the strict security level", () => {
    expect(getMermaidConfig(false).securityLevel).toBe("strict")
    expect(getMermaidConfig(true).securityLevel).toBe("strict")
  })

  it("keeps manual initialization", () => {
    expect(getMermaidConfig(false).startOnLoad).toBe(false)
  })
})
