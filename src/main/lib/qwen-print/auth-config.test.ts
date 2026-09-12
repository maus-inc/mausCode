/**
 * qwen-print stored-auth probe tests: settings/env/.env resolution,
 * per-model envKey overrides, legacy OAuth, model listing, dotenv
 * parsing. Secrets are never echoed in probe output.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { listQwenStoredModels, parseQwenDotenv, probeQwenStoredAuth } from "./auth-config"

function makeHome(settings?: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), "qwen-auth-"))
  if (settings) {
    mkdirSync(join(home, ".qwen"), { recursive: true })
    writeFileSync(join(home, ".qwen", "settings.json"), JSON.stringify(settings))
  }
  return home
}

describe("probeQwenStoredAuth", () => {
  it("reports unconfigured when no auth type is selected", () => {
    const home = makeHome({ model: { name: "qwen3-coder-plus" } })
    const probe = probeQwenStoredAuth({ homeDir: home, env: {} })
    expect(probe.configured).toBe(false)
    expect(probe.detail).toMatch(/no qwen auth type/i)
  })

  it("resolves shell env keys above all file sources", () => {
    const home = makeHome({
      security: { auth: { selectedType: "openai" } },
      model: { name: "qwen3-coder-plus" },
      env: { OPENAI_API_KEY: "file-key" },
    })
    const probe = probeQwenStoredAuth({
      homeDir: home,
      env: { OPENAI_API_KEY: "env-key" },
    })
    expect(probe.configured).toBe(true)
    expect(probe.authType).toBe("openai")
    expect(probe.model).toBe("qwen3-coder-plus")
    expect(probe.sources).toContain("environment")
    expect(probe.detail).not.toContain("env-key")
    expect(probe.detail).not.toContain("file-key")
  })

  it("honors per-model envKey overrides", () => {
    const home = makeHome({
      security: { auth: { selectedType: "openai" } },
      model: { name: "qwen3-coder-plus" },
      modelProviders: {
        openai: [
          {
            id: "qwen3-coder-plus",
            baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
            envKey: "BAILIAN_CODING_PLAN_API_KEY",
          },
        ],
      },
    })
    const missing = probeQwenStoredAuth({ homeDir: home, env: {} })
    expect(missing.configured).toBe(false)
    expect(missing.detail).toContain("BAILIAN_CODING_PLAN_API_KEY")
    const present = probeQwenStoredAuth({
      homeDir: home,
      env: { BAILIAN_CODING_PLAN_API_KEY: "sk-sp-x" },
    })
    expect(present.configured).toBe(true)
  })

  it("reads the .env discovery chain (.qwen/.env first)", () => {
    const home = makeHome({
      security: { auth: { selectedType: "openai" } },
      model: { name: "m" },
    })
    const project = mkdtempSync(join(tmpdir(), "qwen-proj-"))
    mkdirSync(join(project, ".qwen"), { recursive: true })
    writeFileSync(join(project, ".qwen", ".env"), 'OPENAI_API_KEY="quoted-key"\n')
    const probe = probeQwenStoredAuth({
      homeDir: home,
      projectDir: project,
      env: {},
    })
    expect(probe.configured).toBe(true)
    expect(probe.sources.some((s) => s.endsWith(".env"))).toBe(true)
  })

  it("stops at the first .env file found (no cross-file merge)", () => {
    const home = makeHome({
      security: { auth: { selectedType: "openai" } },
    })
    const project = mkdtempSync(join(tmpdir(), "qwen-proj2-"))
    mkdirSync(join(project, ".qwen"), { recursive: true })
    writeFileSync(join(project, ".qwen", ".env"), "OTHER_VAR=1\n")
    mkdirSync(join(home, ".qwen"), { recursive: true })
    writeFileSync(join(home, ".qwen", ".env"), "OPENAI_API_KEY=home-key\n")
    const probe = probeQwenStoredAuth({
      homeDir: home,
      projectDir: project,
      env: {},
    })
    // First file wins upstream and lacks the key: unconfigured.
    expect(probe.configured).toBe(false)
  })

  it("falls back to settings env last", () => {
    const home = makeHome({
      security: { auth: { selectedType: "anthropic" } },
      env: { ANTHROPIC_API_KEY: "sk-ant-x" },
    })
    const probe = probeQwenStoredAuth({ homeDir: home, env: {} })
    expect(probe.configured).toBe(true)
    expect(probe.authType).toBe("anthropic")
  })

  it("treats legacy qwen-oauth as cache presence only", () => {
    const home = makeHome({
      security: { auth: { selectedType: "qwen-oauth" } },
    })
    const without = probeQwenStoredAuth({ homeDir: home, env: {} })
    expect(without.configured).toBe(false)
    writeFileSync(join(home, ".qwen", "oauth_creds.json"), "{}")
    const cached = probeQwenStoredAuth({ homeDir: home, env: {} })
    expect(cached.configured).toBe(true)
    expect(cached.legacyOAuthCache).toBe(true)
  })

  it("supports keyless Vertex ADC via project env", () => {
    const home = makeHome({
      security: { auth: { selectedType: "vertex-ai" } },
    })
    const probe = probeQwenStoredAuth({
      homeDir: home,
      env: { GOOGLE_CLOUD_PROJECT: "proj" },
    })
    expect(probe.configured).toBe(true)
  })
})

describe("listQwenStoredModels", () => {
  it("lists modelProviders ids across protocols, deduped", () => {
    const home = makeHome({
      modelProviders: {
        openai: [{ id: "qwen3-coder-plus", name: "Coder Plus" }, { id: "qwen3-coder-plus" }],
        anthropic: [{ id: "claude-x" }],
        broken: "nope",
      },
    })
    const models = listQwenStoredModels(home)
    expect(models).toEqual([
      { id: "qwen3-coder-plus", protocol: "openai", name: "Coder Plus" },
      { id: "claude-x", protocol: "anthropic" },
    ])
  })

  it("returns [] without settings", () => {
    expect(listQwenStoredModels(makeHome())).toEqual([])
  })
})

describe("parseQwenDotenv", () => {
  it("parses export prefixes, quotes, and comments", () => {
    const parsed = parseQwenDotenv(
      "# comment\nexport A=1\nB=\"two\"\nC='three'\nEMPTY=\nBAD LINE\n",
    )
    expect(parsed).toMatchObject({ A: "1", B: "two", C: "three", EMPTY: "" })
    expect(parsed.BAD).toBeUndefined()
  })
})
