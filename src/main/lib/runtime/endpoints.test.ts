/**
 * Endpoint pure-logic tests (no Electron, no DB, no daemon):
 *   node --test --experimental-strip-types src/main/lib/runtime/endpoints.test.ts
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildDaemonEndpointEnv,
  endpointMatches,
  isHonoredEndpoint,
  normalizeEndpointUrl,
} from "./endpoint-urls.ts"

test("normalizeEndpointUrl accepts http(s), trims slashes", () => {
  assert.equal(normalizeEndpointUrl("https://proxy.local/v1/"), "https://proxy.local/v1")
  assert.equal(normalizeEndpointUrl("  http://localhost:11434/ "), "http://localhost:11434")
})

test("normalizeEndpointUrl rejects non-http and garbage", () => {
  assert.throws(() => normalizeEndpointUrl("not a url"), /Invalid endpoint URL/)
  assert.throws(() => normalizeEndpointUrl("ftp://x/y"), /must be http/)
  assert.throws(() => normalizeEndpointUrl(""), /Invalid endpoint URL/)
})

test("endpointMatches ignores trailing slashes and case", () => {
  assert.equal(endpointMatches("https://proxy.local/v1/", "https://proxy.local/v1"), true)
  assert.equal(endpointMatches("https://PROXY.local/v1", "https://proxy.local/v1"), true)
  assert.equal(endpointMatches("https://a.local/v1", "https://b.local/v1"), false)
  assert.equal(endpointMatches("garbage", "https://proxy.local/v1"), false)
})

test("isHonoredEndpoint matches settings", () => {
  const settings = { openaiBaseUrl: "https://proxy.local/v1", anthropicBaseUrl: null }
  assert.equal(isHonoredEndpoint("https://proxy.local/v1/", settings), true)
  assert.equal(isHonoredEndpoint("https://other.local/v1", settings), false)
})

test("isHonoredEndpoint matches ambient env overrides", () => {
  const prev = process.env.OPENAI_BASE_URL
  process.env.OPENAI_BASE_URL = "http://localhost:11434/v1"
  try {
    assert.equal(
      isHonoredEndpoint("http://localhost:11434/v1", { openaiBaseUrl: null, anthropicBaseUrl: null }),
      true,
    )
  } finally {
    if (prev === undefined) delete process.env.OPENAI_BASE_URL
    else process.env.OPENAI_BASE_URL = prev
  }
})

test("buildDaemonEndpointEnv uses JCODE_* names and skips unset", () => {
  assert.deepEqual(
    buildDaemonEndpointEnv({ openaiBaseUrl: "https://proxy.local/v1", anthropicBaseUrl: null }),
    { JCODE_OPENAI_API_BASE: "https://proxy.local/v1" },
  )
  assert.deepEqual(
    buildDaemonEndpointEnv({ openaiBaseUrl: null, anthropicBaseUrl: null }),
    {},
  )
})
