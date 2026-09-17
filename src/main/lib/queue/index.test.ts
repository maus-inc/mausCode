/**
 * Queue main-process hooks (roadmap step 08). Two functions sit between the app
 * and the store: startup recovery, which must return every interrupted send
 * without ever blocking the app, and the window-close release, which must hand
 * back what a dead window held without throwing into Electron's close path.
 * The store is a fake here — its own rules are the subject of
 * `queue-state.test.ts` — so what these tests pin is the wiring: the singleton,
 * the retry, and the fact that neither hook may throw at the app.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const held = vi.hoisted(() => ({
  recoverSending: vi.fn(),
  releaseOwner: vi.fn(),
  createQueueStore: vi.fn(),
}))

// `./index.ts` reaches for the app's database and the real store; both are
// replaced, so no Electron import and no schema are needed to test the hooks.
vi.mock("../db", () => ({ getDatabase: () => ({}) }))
vi.mock("./queue-state", () => ({ createQueueStore: held.createQueueStore }))

import { getQueueStore, recoverQueuedSends, releaseQueueClaimsForWindow } from "./index"

describe("queue main-process hooks", () => {
  beforeEach(() => {
    held.recoverSending.mockReset()
    held.releaseOwner.mockReset()
    held.createQueueStore.mockReset()
    held.createQueueStore.mockReturnValue({
      recoverSending: held.recoverSending,
      releaseOwner: held.releaseOwner,
    })
  })

  it("recovers interrupted sends once at startup and reports how many", () => {
    held.recoverSending.mockReturnValue(2)

    expect(recoverQueuedSends()).toBe(2)
    expect(held.recoverSending).toHaveBeenCalledTimes(1)
  })

  it("retries a failed recovery instead of leaving rows claimed", () => {
    held.recoverSending
      .mockImplementationOnce(() => {
        throw new Error("database is locked")
      })
      .mockReturnValue(1)

    expect(recoverQueuedSends()).toBe(1)
    expect(held.recoverSending).toHaveBeenCalledTimes(2)
  })

  it("gives up after its attempts and lets the app start", () => {
    held.recoverSending.mockImplementation(() => {
      throw new Error("database is locked")
    })

    expect(recoverQueuedSends(2)).toBe(0)
    expect(held.recoverSending).toHaveBeenCalledTimes(2)
  })

  it("hands a closed window's claims back to the queue", () => {
    held.releaseOwner.mockReturnValue(3)

    expect(releaseQueueClaimsForWindow("window-2")).toBe(3)
    expect(held.releaseOwner).toHaveBeenCalledWith("window-2")
  })

  it("swallows a release failure so a closing window still closes", () => {
    held.releaseOwner.mockImplementation(() => {
      throw new Error("database is locked")
    })

    expect(releaseQueueClaimsForWindow("window-2")).toBe(0)
  })

  it("shares one store between both hooks", () => {
    held.recoverSending.mockReturnValue(0)
    held.releaseOwner.mockReturnValue(0)

    // The store outlives every call: a second construction would hand the two
    // hooks different stores, and with them different subscriber sets.
    const store = getQueueStore()
    recoverQueuedSends()
    releaseQueueClaimsForWindow("main")

    expect(getQueueStore()).toBe(store)
    expect(held.createQueueStore.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
