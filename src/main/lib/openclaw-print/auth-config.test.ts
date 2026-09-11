/**
 * openclaw-print auth-surface tests: provider env map, models-status
 * parsing + summary over a sanitized LIVE capture (shape recorded
 * from `openclaw models status --json`, secret-adjacent values
 * replaced — the CLI redacts them in this output anyway).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"
import {
  OPENCLAW_PROVIDER_ENV_VARS,
  openclawConfigPath,
  parseOpenclawModelsList,
  parseOpenclawModelsStatus,
  summarizeModelsStatusAuth,
} from "./auth-config"

const FIXTURE = readFileSync(
  join(
    fileURLToPath(new URL(".", import.meta.url)),
    "test",
    "fixtures",
    "openclaw-models-status.json",
  ),
  "utf8",
)

describe("provider env vars", () => {
  it("maps every held provider to its live-verified key variable", () => {
    assert.deepEqual(OPENCLAW_PROVIDER_ENV_VARS, {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
      xai: "XAI_API_KEY",
    })
  })

  it("resolves the ambient config path under $HOME", () => {
    assert.equal(
      openclawConfigPath({ env: { HOME: "/tmp/oc-home" } as NodeJS.ProcessEnv }),
      join("/tmp/oc-home", ".openclaw", "openclaw.json"),
    )
  })
})

describe("models status parsing", () => {
  it("parses the live capture: default, missing, providers", () => {
    const status = parseOpenclawModelsStatus(FIXTURE)
    assert.ok(status)
    assert.equal(status?.defaultModel, "openai/gpt-5.6-sol")
    assert.deepEqual(status?.missingProvidersInUse, ["openai"])
    assert.equal(status?.providers.length, 1)
    assert.equal(status?.providers[0].provider, "github-copilot")
    assert.equal(status?.providers[0].kind, "env")
    assert.equal(status?.providers[0].source, "env: GH_TOKEN")
  })

  it("summarizes usable ambient auth as configured", () => {
    const summary = summarizeModelsStatusAuth(parseOpenclawModelsStatus(FIXTURE))
    assert.equal(summary.configured, true)
    assert.equal(summary.provider, "github-copilot")
    assert.equal(summary.model, "openai/gpt-5.6-sol")
    assert.ok(summary.detail.includes("github-copilot"))
  })

  it("summarizes missing auth as not configured", () => {
    const summary = summarizeModelsStatusAuth(
      parseOpenclawModelsStatus(
        JSON.stringify({
          defaultModel: "openai/gpt-5.6-sol",
          auth: { missingProvidersInUse: ["openai"], providers: [] },
        }),
      ),
    )
    assert.equal(summary.configured, false)
    assert.ok(summary.detail.includes("openai"))
  })

  it("returns null on unparseable output (summary degrades)", () => {
    assert.equal(parseOpenclawModelsStatus("not json"), null)
    assert.equal(summarizeModelsStatusAuth(null).configured, false)
  })
})

describe("models list parsing", () => {
  const LIST_FIXTURE = readFileSync(
    join(
      fileURLToPath(new URL(".", import.meta.url)),
      "test",
      "fixtures",
      "openclaw-models-list.json",
    ),
    "utf8",
  )

  it("parses the live list shape (trimmed to 3 entries)", () => {
    const models = parseOpenclawModelsList(LIST_FIXTURE)
    assert.equal(models.length, 3)
    assert.deepEqual(models[0], {
      id: "openai/gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      available: false,
    })
    assert.equal(models[1].id, "anthropic/claude-opus-5")
    assert.equal(models[1].available, true)
  })

  it("returns [] on unparseable output (never throws)", () => {
    assert.deepEqual(parseOpenclawModelsList("not json"), [])
  })
})
