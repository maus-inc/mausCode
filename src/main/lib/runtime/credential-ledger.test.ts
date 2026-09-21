/**
 * Credential ledger tests (no Electron, no daemon):
 *   node --test --experimental-strip-types src/main/lib/runtime/credential-ledger.test.ts
 */

import assert from "node:assert/strict"
import { test } from "node:test"
import {
  beginCredentialTurn,
  claimCredential,
  planCredentialRelease,
  runCredentialTurn,
} from "./credential-ledger.ts"

/** The providers a plan asks to clear, without settling it. */
function planned(sessionId: string, generation: number, providers: readonly string[]): string[] {
  return planCredentialRelease(sessionId, generation, providers).providers
}

/** A completed release, the way releaseNativeEphemeralCredentials runs it. */
function released(sessionId: string, generation: number, providers: readonly string[]): string[] {
  const plan = planCredentialRelease(sessionId, generation, providers)
  plan.settle()
  return plan.providers
}

/** A turn that wrote every provider it claims, the way applyNativeCredentials does. */
function turn(sessionId: string, providers: readonly string[]): number {
  const generation = beginCredentialTurn(sessionId)
  for (const provider of providers) claimCredential(sessionId, generation, provider)
  return generation
}

test("the turn that wrote the keys releases all of them", () => {
  const generation = turn("session-a", ["anthropic-api", "openai-api"])
  assert.deepEqual(released("session-a", generation, ["anthropic-api", "openai-api"]), [
    "anthropic-api",
    "openai-api",
  ])
})

test("a replaced turn keeps its hands off the key its replacement wrote", () => {
  const replaced = turn("session-b", ["anthropic-api"])
  const replacement = turn("session-b", ["anthropic-api"])
  assert.deepEqual(released("session-b", replaced, ["anthropic-api"]), [])
  // The replacement still owns its own release.
  assert.deepEqual(released("session-b", replacement, ["anthropic-api"]), ["anthropic-api"])
})

test("a replaced turn releases only the providers the replacement did not write", () => {
  const replaced = turn("session-c", ["anthropic-api", "openai-api"])
  turn("session-c", ["anthropic-api"])
  assert.deepEqual(released("session-c", replaced, ["anthropic-api", "openai-api"]), ["openai-api"])
})

test("a straggler cannot clear a slot a newer turn has taken", () => {
  const first = turn("session-d", ["anthropic-api"])
  assert.deepEqual(released("session-d", first, ["anthropic-api"]), ["anthropic-api"])
  const second = turn("session-d", ["anthropic-api"])
  released("session-d", second, ["anthropic-api"])
  // The newer turn released and a third turn took the slot. The straggler asks
  // for nothing, because the slot no longer holds the value it wrote.
  const third = turn("session-d", ["anthropic-api"])
  assert.deepEqual(released("session-d", first, ["anthropic-api"]), [])
  assert.deepEqual(released("session-d", third, ["anthropic-api"]), ["anthropic-api"])
})

test("a generation number is never reused for a session", () => {
  const first = turn("session-e", ["anthropic-api"])
  released("session-e", first, ["anthropic-api"])
  const second = turn("session-e", ["anthropic-api"])
  assert.notEqual(second, first)
})

test("a failed handoff clears the keys it wrote and leaves the replacement's alone", () => {
  // The turn that fails is the older one: the replacement took openai-api, so
  // only the key this turn actually wrote comes back.
  const failed = turn("session-f", ["anthropic-api"])
  const replacement = turn("session-f", ["openai-api"])
  assert.deepEqual(planned("session-f", failed, ["anthropic-api"]), ["anthropic-api"])
  assert.deepEqual(planned("session-f", replacement, ["openai-api"]), ["openai-api"])
})

test("a failed handoff that wrote nothing clears nothing", () => {
  const failed = beginCredentialTurn("session-g")
  // The first write threw, so no provider was ever claimed.
  assert.deepEqual(planned("session-g", failed, []), [])
})

test("a release gives up ownership once it settles, so a second call asks for nothing", () => {
  const generation = turn("session-h", ["anthropic-api"])
  assert.deepEqual(released("session-h", generation, ["anthropic-api"]), ["anthropic-api"])
  assert.deepEqual(planned("session-h", generation, ["anthropic-api"]), [])
})

test("a provider claimed while its clear was in flight is not given up", () => {
  // The ledger keeps ownership until the clear settles, so a replacement that
  // claims the provider during that window still owns its release.
  const replaced = turn("session-j", ["anthropic-api"])
  const plan = planCredentialRelease("session-j", replaced, ["anthropic-api"])
  assert.deepEqual(plan.providers, ["anthropic-api"])
  // A second plan for the same generation asks for nothing, so one provider is
  // never cleared twice while the first clear is still running.
  assert.deepEqual(planned("session-j", replaced, ["anthropic-api"]), [])
  // The replacement claims the provider while the older clear is in flight.
  const replacement = turn("session-j", ["anthropic-api"])
  plan.settle()
  // The older clear settled after the replacement claimed the provider, and the
  // replacement kept ownership of the value it is running on.
  assert.deepEqual(released("session-j", replacement, ["anthropic-api"]), ["anthropic-api"])
  assert.deepEqual(planned("session-j", replaced, ["anthropic-api"]), [])
})

test("a release for a session the ledger never saw may clear what it wrote", () => {
  assert.deepEqual(planned("session-i", 0, []), [])
  assert.deepEqual(released("session-i", 1, ["anthropic-api"]), ["anthropic-api"])
})

test("a clear and a write for one session never run at the same time", async () => {
  const order: string[] = []
  let releaseClear: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    releaseClear = resolve
  })
  const clear = runCredentialTurn("session-k", async () => {
    order.push("clear-start")
    await held
    order.push("clear-end")
  })
  const write = runCredentialTurn("session-k", async () => {
    order.push("write")
  })
  // The write waits for the clear, because the daemon holds one value per
  // provider and a clear that landed second would remove the new key.
  await Promise.resolve()
  assert.deepEqual(order, ["clear-start"])
  releaseClear()
  await Promise.all([clear, write])
  assert.deepEqual(order, ["clear-start", "clear-end", "write"])
})

test("a turn that failed does not hold up the next turn", async () => {
  const order: string[] = []
  const failed = runCredentialTurn("session-l", async () => {
    order.push("failed")
    throw new Error("the daemon refused the key")
  })
  const next = runCredentialTurn("session-l", async () => {
    order.push("next")
  })
  await assert.rejects(failed, /refused/)
  await next
  assert.deepEqual(order, ["failed", "next"])
})

test("sessions do not wait for each other", async () => {
  const order: string[] = []
  let releaseFirst: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const first = runCredentialTurn("session-m", async () => {
    order.push("first-start")
    await held
    order.push("first-end")
  })
  const other = runCredentialTurn("session-n", async () => {
    order.push("other")
  })
  await other
  assert.deepEqual(order, ["first-start", "other"])
  releaseFirst()
  await first
})
