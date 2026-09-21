/**
 * Credential ledger tests (no Electron, no daemon):
 *   node --test --experimental-strip-types src/main/lib/runtime/credential-ledger.test.ts
 */

import assert from "node:assert/strict"
import { test } from "node:test"
import { markCredentialsApplied, planCredentialRelease } from "./credential-ledger.ts"

test("the turn that wrote the keys releases all of them", () => {
  const generation = markCredentialsApplied("session-a", ["anthropic-api", "openai-api"])
  assert.deepEqual(
    planCredentialRelease("session-a", generation, ["anthropic-api", "openai-api"]),
    ["anthropic-api", "openai-api"],
  )
})

test("a replaced turn keeps its hands off the key its replacement wrote", () => {
  const replaced = markCredentialsApplied("session-b", ["anthropic-api"])
  const replacement = markCredentialsApplied("session-b", ["anthropic-api"])
  assert.deepEqual(planCredentialRelease("session-b", replaced, ["anthropic-api"]), [])
  // The replacement still owns its own release.
  assert.deepEqual(planCredentialRelease("session-b", replacement, ["anthropic-api"]), [
    "anthropic-api",
  ])
})

test("a replaced turn releases only the providers the replacement did not write", () => {
  const replaced = markCredentialsApplied("session-c", ["anthropic-api", "openai-api"])
  markCredentialsApplied("session-c", ["anthropic-api"])
  assert.deepEqual(planCredentialRelease("session-c", replaced, ["anthropic-api", "openai-api"]), [
    "openai-api",
  ])
})

test("a late release from an older generation still clears a key nothing replaced", () => {
  const first = markCredentialsApplied("session-d", ["anthropic-api"])
  planCredentialRelease("session-d", first, ["anthropic-api"])
  const second = markCredentialsApplied("session-d", ["anthropic-api"])
  planCredentialRelease("session-d", second, ["anthropic-api"])
  // The newest record is gone, so a straggler owns no newer slot to protect.
  assert.deepEqual(planCredentialRelease("session-d", first, ["anthropic-api"]), ["anthropic-api"])
})

test("a release for a session with no record and no providers asks for nothing", () => {
  assert.deepEqual(planCredentialRelease("session-e", 0, []), [])
})
