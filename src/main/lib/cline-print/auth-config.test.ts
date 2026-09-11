/**
 * cline-print stored-auth probe tests. providers.json shape verified
 * live against cline CLI v3.0.61 (`cline auth` output).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { probeClineStoredAuth } from "./auth-config"

function makeHome(providers: unknown): string {
  const home = mkdtempSync(join(tmpdir(), "cline-auth-test-"))
  const dir = join(home, ".cline", "data", "settings")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "providers.json"), JSON.stringify(providers))
  return home
}

describe("probeClineStoredAuth", () => {
  it("reports unconfigured when no file exists", () => {
    const home = mkdtempSync(join(tmpdir(), "cline-auth-test-"))
    try {
      const result = probeClineStoredAuth({ homeDir: home })
      expect(result.configured).toBe(false)
      expect(result.sources).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("detects a stored key on the last-used provider", () => {
    const home = makeHome({
      version: 1,
      lastUsedProvider: "openrouter",
      providers: {
        openrouter: {
          settings: {
            provider: "openrouter",
            apiKey: "sk-or-SECRET",
            model: "google/gemini-3-pro",
          },
        },
      },
    })
    try {
      const result = probeClineStoredAuth({ homeDir: home })
      expect(result.configured).toBe(true)
      expect(result.provider).toBe("openrouter")
      expect(result.model).toBe("google/gemini-3-pro")
      // The secret itself never surfaces.
      expect(JSON.stringify(result)).not.toContain("SECRET")
      expect(result.sources).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("treats local runtimes as configured without a key", () => {
    const home = makeHome({
      version: 1,
      lastUsedProvider: "ollama",
      providers: { ollama: { settings: { provider: "ollama" } } },
    })
    try {
      const result = probeClineStoredAuth({ homeDir: home })
      expect(result.configured).toBe(true)
      expect(result.provider).toBe("ollama")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("reports a keyless last-used provider as unconfigured", () => {
    const home = makeHome({
      version: 1,
      lastUsedProvider: "anthropic",
      providers: { anthropic: { settings: { provider: "anthropic" } } },
    })
    try {
      const result = probeClineStoredAuth({ homeDir: home })
      expect(result.configured).toBe(false)
      expect(result.provider).toBe("anthropic")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
