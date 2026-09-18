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

/**
 * Counts the listener releases the store's own subscribe hands back, so a wait
 * that resolves can be checked for giving its subscription up.
 */
function countListenerReleases() {
  const releases = { count: 0, restore: () => {} }
  const realSubscribe = useStreamingStatusStore.subscribe
  const spy = vi.spyOn(useStreamingStatusStore, "subscribe").mockImplementation(((
    selector: (state: unknown) => unknown,
    listener: (value: unknown) => void,
  ) => {
    const unsubscribe = realSubscribe(
      selector as Parameters<typeof realSubscribe>[0],
      listener as Parameters<typeof realSubscribe>[1],
    )
    return () => {
      releases.count += 1
      unsubscribe()
    }
  }) as never)
  releases.restore = () => spy.mockRestore()
  return releases
}

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

  it("does not treat a stale error as a live turn at the first ask", async () => {
    // The wait is asked after a send is invoked, when the last status the
    // sub-chat reported may be an `error`. Only a turn means the message left.
    useStreamingStatusStore.getState().setStatus("sub-a", "error")
    const waiter = waitForTurnStart("sub-a")
    let started = false
    void waiter.promise.then(() => {
      started = true
    })
    await Promise.resolve()
    expect(started).toBe(false)

    useStreamingStatusStore.getState().setStatus("sub-a", "submitted")
    await waiter.promise
    expect(started).toBe(true)
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

describe("the status vocabulary", () => {
  beforeEach(() => {
    useStreamingStatusStore.setState({ statuses: {} })
  })

  it("counts a submitted turn as live, because the message is already in flight", () => {
    const store = useStreamingStatusStore.getState()
    const live = ["streaming", "submitted"] as const
    for (const status of live) {
      store.setStatus("sub-a", status)
      expect(store.isStreaming("sub-a")).toBe(true)
    }

    // Neither of these is a turn: `error` means nothing went out and `ready`
    // means the previous one is over.
    for (const status of ["error", "ready"] as const) {
      store.setStatus("sub-a", status)
      expect(store.isStreaming("sub-a")).toBe(false)
    }
  })

  it("clears a finished sub-chat's status instead of keeping the last one", () => {
    const store = useStreamingStatusStore.getState()
    store.setStatus("sub-a", "streaming")
    store.setStatus("sub-b", "streaming")

    store.clearStatus("sub-a")

    expect(store.getStatus("sub-a")).toBe("ready")
    expect(store.isStreaming("sub-a")).toBe(false)
    // The other sub-chat is untouched: clearing one is not clearing the store.
    expect(store.getStatus("sub-b")).toBe("streaming")
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

  it("gives the store's listener back when the turn reports that it stopped", async () => {
    useStreamingStatusStore.getState().setStatus("sub-a", "streaming")
    const releases = countListenerReleases()

    const ready = waitForStreamingReady("sub-a")
    useStreamingStatusStore.getState().setStatus("sub-a", "ready")
    await expect(ready).resolves.toBe(true)

    // Every send that waits holds one listener, so one left behind per send is
    // a listener per message the user sends.
    expect(releases.count).toBe(1)
    releases.restore()
  })

  it("gives the store's listener back when it gives up waiting", async () => {
    vi.useFakeTimers()
    useStreamingStatusStore.getState().setStatus("sub-a", "streaming")
    const releases = countListenerReleases()

    const ready = waitForStreamingReady("sub-a")
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(ready).resolves.toBe(false)
    expect(releases.count).toBe(1)
    releases.restore()
    vi.useRealTimers()
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
