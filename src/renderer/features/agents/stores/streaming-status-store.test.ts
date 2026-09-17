/**
 * Status-wait tests (roadmap step 08). The queue sender races a wait for the
 * turn to start against the send settling, so the wait has to give the
 * subscription back when the caller stops waiting.
 */
import { beforeEach, describe, expect, it } from "vitest"
import { useStreamingStatusStore, waitForTurnStart } from "./streaming-status-store"

describe("waitForTurnStart", () => {
  beforeEach(() => {
    useStreamingStatusStore.setState({ statuses: {} })
  })

  it("resolves when the status reports a live turn", async () => {
    let resolved = false
    const waiter = waitForTurnStart("sub-a")
    void waiter.promise.then(() => {
      resolved = true
    })

    useStreamingStatusStore.getState().setStatus("sub-a", "submitted")
    await waiter.promise

    expect(resolved).toBe(true)
  })

  it("resolves at once when a turn is already live", async () => {
    useStreamingStatusStore.getState().setStatus("sub-a", "streaming")

    await expect(waitForTurnStart("sub-a").promise).resolves.toBeUndefined()
  })

  it("stops observing once the caller cancels a lost wait", async () => {
    let resolved = false
    const waiter = waitForTurnStart("sub-a")
    void waiter.promise.then(() => {
      resolved = true
    })

    waiter.cancel()
    useStreamingStatusStore.getState().setStatus("sub-a", "streaming")
    await Promise.resolve()

    expect(resolved).toBe(false)
  })

  it("does not resolve on a status that means the message never left", async () => {
    let resolved = false
    const waiter = waitForTurnStart("sub-a")
    void waiter.promise.then(() => {
      resolved = true
    })

    useStreamingStatusStore.getState().setStatus("sub-a", "error")
    useStreamingStatusStore.getState().setStatus("sub-a", "ready")
    await Promise.resolve()

    expect(resolved).toBe(false)
    waiter.cancel()
  })
})
