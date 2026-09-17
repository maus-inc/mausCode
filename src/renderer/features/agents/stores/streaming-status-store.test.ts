/**
 * Status-wait tests (roadmap step 08). The queue sender races a wait for the
 * turn to start against the send settling, so the wait has to give the
 * subscription back when the caller stops waiting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  useStreamingStatusStore,
  waitForStreamingReady,
  waitForTurnStart,
} from "./streaming-status-store"

describe("waitForTurnStart", () => {
  beforeEach(() => {
    useStreamingStatusStore.setState({ statuses: {} })
  })

  // One test below runs on fake timers. Restoring them here means a failure
  // inside it cannot leave every later test in the file waiting on a clock
  // nobody advances.
  afterEach(() => {
    vi.useRealTimers()
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

  it("gives up on the status, not on the send, when no turn reports itself in time", async () => {
    vi.useFakeTimers()
    const waiter = waitForTurnStart("sub-a", 1000)
    let started = false
    let expired = false
    void waiter.promise.then(() => {
      started = true
    })
    void waiter.expired.then(() => {
      expired = true
    })

    await vi.advanceTimersByTimeAsync(1000)

    expect(expired).toBe(true)
    expect(started).toBe(false)
    // The listener is gone by the time it gives up.
    useStreamingStatusStore.getState().setStatus("sub-a", "streaming")
    await Promise.resolve()
    expect(started).toBe(false)
    waiter.cancel()
    vi.useRealTimers()
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

describe("waitForStreamingReady", () => {
  beforeEach(() => {
    useStreamingStatusStore.setState({ statuses: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves true at once when no turn is streaming", async () => {
    await expect(waitForStreamingReady("sub-a")).resolves.toBe(true)
  })

  it("resolves true when the turn reports that it is done", async () => {
    useStreamingStatusStore.getState().setStatus("sub-a", "streaming")
    const ready = waitForStreamingReady("sub-a")

    useStreamingStatusStore.getState().setStatus("sub-a", "ready")

    await expect(ready).resolves.toBe(true)
  })

  it("resolves false when the turn never reports that it stopped", async () => {
    vi.useFakeTimers()
    useStreamingStatusStore.getState().setStatus("sub-a", "streaming")
    const ready = waitForStreamingReady("sub-a")
    let settled: boolean | null = null
    void ready.then((value) => {
      settled = value
    })

    await vi.advanceTimersByTimeAsync(30_000)
    const answer = await ready
    await Promise.resolve()

    // A caller that starts a send anyway would run two turns at once.
    expect(answer).toBe(false)
    expect(settled).toBe(false)
  })
})
