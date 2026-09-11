/**
 * roo-print auth surface tests: env map, settings parse, ambient
 * resolution, and provider-scoped model tables.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import {
  DEFAULT_ROO_PROVIDER,
  isKnownRooModelId,
  isRooSupportedProvider,
  parseRooCliSettings,
  ROO_PROVIDER_DEFAULT_MODELS,
  ROO_PROVIDER_ENV_VARS,
  ROO_PROVIDER_MODELS,
  resolveRooAmbientAuth,
} from "./auth-config"

describe("provider surface", () => {
  it("covers the five CLI-supported providers with env vars", () => {
    assert.deepEqual(Object.keys(ROO_PROVIDER_ENV_VARS), [
      "anthropic",
      "openai-native",
      "gemini",
      "openrouter",
      "vercel-ai-gateway",
    ])
    assert.equal(ROO_PROVIDER_ENV_VARS.gemini, "GOOGLE_API_KEY")
    assert.equal(DEFAULT_ROO_PROVIDER, "openrouter")
    assert.ok(isRooSupportedProvider("gemini"))
    assert.ok(!isRooSupportedProvider("openai"))
  })

  it("keeps every provider default inside its own model table", () => {
    for (const provider of Object.keys(ROO_PROVIDER_MODELS) as Array<
      keyof typeof ROO_PROVIDER_MODELS
    >) {
      const fallback = ROO_PROVIDER_DEFAULT_MODELS[provider]
      assert.ok(
        isKnownRooModelId(provider, fallback),
        `${provider} default ${fallback} must be a known id`,
      )
      assert.ok(ROO_PROVIDER_MODELS[provider].length >= 5)
    }
  })

  it("rejects cross-provider ids (silent-fallback guard)", () => {
    assert.ok(!isKnownRooModelId("anthropic", "anthropic/claude-opus-4.6"))
    assert.ok(isKnownRooModelId("openrouter", "anthropic/claude-opus-4.6"))
    assert.ok(isKnownRooModelId("anthropic", "claude-sonnet-4-5"))
  })
})

describe("parseRooCliSettings", () => {
  it("parses provider/model/mode and tolerates garbage", () => {
    assert.deepEqual(parseRooCliSettings('{"provider":"gemini","model":"m","mode":"ask"}'), {
      provider: "gemini",
      model: "m",
      mode: "ask",
    })
    assert.deepEqual(parseRooCliSettings("nope"), {})
    assert.deepEqual(parseRooCliSettings("[]"), {})
  })
})

describe("resolveRooAmbientAuth", () => {
  const withHome = (settings: string | null) => {
    const home = mkdtempSync(join(tmpdir(), "roo-auth-"))
    if (settings !== null) {
      mkdirSync(join(home, ".roo"), { recursive: true })
      writeFileSync(join(home, ".roo", "cli-settings.json"), settings)
    }
    return home
  }

  it("resolves the settings provider via its env var", () => {
    const home = withHome('{"provider":"gemini"}')
    try {
      const hit = resolveRooAmbientAuth({
        homeDir: home,
        env: { GOOGLE_API_KEY: "x" } as NodeJS.ProcessEnv,
      })
      assert.equal(hit.provider, "gemini")
      assert.equal(hit.configured, true)

      const miss = resolveRooAmbientAuth({
        homeDir: home,
        env: {} as NodeJS.ProcessEnv,
      })
      assert.equal(miss.configured, false)
      assert.ok(miss.detail.includes("GOOGLE_API_KEY"))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("defaults to openrouter without settings", () => {
    const home = withHome(null)
    try {
      const auth = resolveRooAmbientAuth({
        homeDir: home,
        env: { OPENROUTER_API_KEY: "x" } as NodeJS.ProcessEnv,
      })
      assert.equal(auth.provider, "openrouter")
      assert.equal(auth.configured, true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
