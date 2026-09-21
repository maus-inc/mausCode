/**
 * Credential ledger tests (no Electron, no daemon):
 *   node --test --experimental-strip-types src/main/lib/runtime/credential-ledger.test.ts
 */

import assert from "node:assert/strict"
import { test } from "node:test"
import { beginCredentialTurn, claimCredential, planCredentialRelease } from "./credential-ledger.ts"

/** A turn that wrote every provider it claims, the way applyNativeCredentials does. */
function turn(sessionId: string, providers: readonly string[]): number {
  const generation = beginCredentialTurn(sessionId)
  for (const provider of providers) claimCredential(sessionId, generation, provider)
  return generation
}

test("the turn that wrote the keys releases all of them", () => {
  const generation = turn("session-a", ["anthropic-api", "openai-api"])
  assert.deepEqual(
    planCredentialRelease("session-a", generation, ["anthropic-api", "openai-api"]),
    ["anthropic-api", "openai-api"],
  )
})

test("a replaced turn keeps its hands off the key its replacement wrote", () => {
  const replaced = turn("session-b", ["anthropic-api"])
  const replacement = turn("session-b", ["anthropic-api"])
  assert.deepEqual(planCredentialRelease("session-b", replaced, ["anthropic-api"]), [])
  // The replacement still owns its own release.
  assert.deepEqual(planCredentialRelease("session-b", replacement, ["anthropic-api"]), [
    "anthropic-api",
  ])
})

test("a replaced turn releases only the providers the replacement did not write", () => {
  const replaced = turn("session-c", ["anthropic-api", "openai-api"])
  turn("session-c", ["anthropic-api"])
  assert.deepEqual(planCredentialRelease("session-c", replaced, ["anthropic-api", "openai-api"]), [
    "openai-api",
  ])
})

test("a straggler cannot clear a slot a newer turn has taken", () => {
  const first = turn("session-d", ["anthropic-api"])
  assert.deepEqual(planCredentialRelease("session-d", first, ["anthropic-api"]), ["anthropic-api"])
  const second = turn("session-d", ["anthropic-api"])
  planCredentialRelease("session-d", second, ["anthropic-api"])
  // The newer turn released and a third turn took the slot. The straggler asks
  // for nothing, because the slot no longer holds the value it wrote.
  const third = turn("session-d", ["anthropic-api"])
  assert.deepEqual(planCredentialRelease("session-d", first, ["anthropic-api"]), [])
  assert.deepEqual(planCredentialRelease("session-d", third, ["anthropic-api"]), ["anthropic-api"])
})

test("a generation number is never reused for a session", () => {
  const first = turn("session-e", ["anthropic-api"])
  planCredentialRelease("session-e", first, ["anthropic-api"])
  const second = turn("session-e", ["anthropic-api"])
  assert.notEqual(second, first)
})

test("a failed handoff clears the keys it wrote and leaves the replacement's alone", () => {
  // The turn that fails is the older one: the replacement took openai-api, so
  // only the key this turn actually wrote comes back.
  const failed = turn("session-f", ["anthropic-api"])
  const replacement = turn("session-f", ["openai-api"])
  assert.deepEqual(planCredentialRelease("session-f", failed, ["anthropic-api"]), ["anthropic-api"])
  assert.deepEqual(planCredentialRelease("session-f", replacement, ["openai-api"]), ["openai-api"])
})

test("a failed handoff that wrote nothing clears nothing", () => {
  const failed = beginCredentialTurn("session-g")
  // The first write threw, so no provider was ever claimed.
  assert.deepEqual(planCredentialRelease("session-g", failed, []), [])
})

test("a release gives up ownership, so a second call asks for nothing", () => {
  const generation = turn("session-h", ["anthropic-api"])
  assert.deepEqual(planCredentialRelease("session-h", generation, ["anthropic-api"]), [
    "anthropic-api",
  ])
  assert.deepEqual(planCredentialRelease("session-h", generation, ["anthropic-api"]), [])
})

test("a release for a session the ledger never saw may clear what it wrote", () => {
  assert.deepEqual(planCredentialRelease("session-i", 0, []), [])
  assert.deepEqual(planCredentialRelease("session-i", 1, ["anthropic-api"]), ["anthropic-api"])
})
