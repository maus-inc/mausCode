/**
 * Queue router tests (roadmap step 08). Exercises the read, write and claim
 * surface through the real tRPC caller against a store backed by a real SQLite
 * test database, including what the far side of the boundary bounds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QUEUE_LONG_TEXT_CAP, type QueueItem } from "../../../../shared/queue-item"
import { openMigratedTestDb, seedSubChat, type TestDb } from "../../db/test-fixtures"
import { createQueueStore, type QueueFeedItem, type QueueStore } from "../../queue/queue-state"
import { queueRouter } from "./queue"

const holder = vi.hoisted(() => ({ store: null as QueueStore | null }))

vi.mock("../../queue", () => ({
  getQueueStore: () => {
    if (!holder.store) throw new Error("test store not initialized")
    return holder.store
  },
}))

const WINDOW_A = "window-main"
const WINDOW_B = "window-2"

describe("queue router", () => {
  let opened: TestDb
  let subChatId: string
  const caller = queueRouter.createCaller({ getWindow: () => null })

  beforeEach(() => {
    opened = openMigratedTestDb()
    holder.store = createQueueStore(opened.db)
    subChatId = seedSubChat(opened.db)
  })

  afterEach(() => {
    holder.store = null
    opened.client.close()
  })

  it("adds, lists and orders items", async () => {
    const first = await caller.add({ subChatId, payload: { message: "one" } })
    const second = await caller.add({ subChatId, payload: { message: "two" } })

    const items = await caller.list({ subChatId })

    expect(items.map((item) => item.id)).toEqual([first.id, second.id])
    expect(items.map((item) => item.payload.message)).toEqual(["one", "two"])
  })

  it("accepts a payload at the cap and rejects one past it", async () => {
    const atCap = "x".repeat(QUEUE_LONG_TEXT_CAP)

    // The boundary is the row's: one character past it is a payload the main
    // process refuses instead of storing.
    await expect(caller.add({ subChatId, payload: { message: atCap } })).resolves.toBeDefined()
    await expect(
      caller.add({ subChatId, payload: { message: `${atCap}x` } }),
    ).rejects.toThrowError()
  })

  it("hands one claim to one caller and refuses the second", async () => {
    const item = await caller.add({ subChatId, payload: { message: "one" } })

    const claimed = await caller.claim({ subChatId, owner: WINDOW_A })
    expect(claimed?.id).toBe(item.id)

    await expect(caller.claim({ subChatId, owner: WINDOW_B })).resolves.toBeNull()
  })

  it("stops dispatching while the queue is paused and resumes on an add", async () => {
    await caller.add({ subChatId, payload: { message: "one" } })

    await caller.setPaused({ subChatId, paused: true })
    await expect(caller.claim({ subChatId, owner: WINDOW_A })).resolves.toBeNull()

    await caller.add({ subChatId, payload: { message: "two" } })
    await expect(caller.claim({ subChatId, owner: WINDOW_A })).resolves.not.toBeNull()
  })

  it("records the hand-off only for the window that owns the claim", async () => {
    const item = await caller.add({ subChatId, payload: { message: "one" } })
    await caller.claim({ subChatId, owner: WINDOW_A })

    await expect(caller.markHanded({ subChatId, itemId: item.id, owner: WINDOW_B })).resolves.toBe(
      false,
    )
    await expect(caller.markHanded({ subChatId, itemId: item.id, owner: WINDOW_A })).resolves.toBe(
      true,
    )
    await expect(caller.markHanded({ subChatId, itemId: item.id, owner: WINDOW_A })).resolves.toBe(
      false,
    )
  })

  it("parks a handed row so the queue moves on without resending it", async () => {
    const first = await caller.add({ subChatId, payload: { message: "one" } })
    const second = await caller.add({ subChatId, payload: { message: "two" } })
    await caller.claim({ subChatId, owner: WINDOW_A })
    await caller.markHanded({ subChatId, itemId: first.id, owner: WINDOW_A })

    await expect(caller.park({ subChatId, itemId: first.id, owner: WINDOW_B })).resolves.toBe(false)
    await expect(caller.park({ subChatId, itemId: first.id, owner: WINDOW_A })).resolves.toBe(true)
    // The parked row is still there to decide about, and the next item can go.
    await expect(caller.list({ subChatId })).resolves.toHaveLength(2)
    const next = await caller.claim({ subChatId, owner: WINDOW_A })
    expect(next?.id).toBe(second.id)
  })

  it("removes and clears rows", async () => {
    const first = await caller.add({ subChatId, payload: { message: "one" } })
    const second = await caller.add({ subChatId, payload: { message: "two" } })

    await expect(caller.remove({ subChatId, itemId: first.id })).resolves.toBe(true)
    await expect(caller.remove({ subChatId, itemId: first.id })).resolves.toBe(false)
    // The row that was not asked for is still there, and it is the second one.
    await expect(caller.list({ subChatId })).resolves.toHaveLength(1)
    await expect(caller.list({ subChatId })).resolves.toMatchObject([{ id: second.id }])

    await expect(caller.clear({ subChatId })).resolves.toBe(1)
    await expect(caller.list({ subChatId })).resolves.toHaveLength(0)
  })

  it("moves an item to a visible index", async () => {
    const first = await caller.add({ subChatId, payload: { message: "one" } })
    const second = await caller.add({ subChatId, payload: { message: "two" } })

    const moved = await caller.move({ subChatId, itemId: second.id, index: 0 })

    expect(moved?.map((item) => item.id)).toEqual([second.id, first.id])
  })

  it("replays a snapshot on subscribe, then streams the change", async () => {
    const item = await caller.add({ subChatId, payload: { message: "one" } })

    const items: QueueFeedItem[] = []
    const observable = (await caller.subscribe({ subChatId })) as unknown as {
      subscribe: (observer: { next: (value: QueueFeedItem) => void }) => { unsubscribe: () => void }
    }
    const subscription = observable.subscribe({ next: (value) => items.push(value) })

    expect(items).toHaveLength(1)
    expect(items[0].subChatId).toBe(subChatId)
    expect(items[0].items.map((queued) => queued.id)).toEqual([item.id])

    await caller.remove({ subChatId, itemId: item.id })

    expect(items).toHaveLength(2)
    expect(items[1].items).toHaveLength(0)
    subscription.unsubscribe()
  })

  it("replays the snapshot before anything that lands while it is reading", async () => {
    const real = holder.store as QueueStore

    // The listener is registered before the replay is read, so a change that
    // lands during the read is buffered rather than lost. It must still be
    // emitted *after* the snapshot: flushing it first has the window apply an
    // older snapshot on top of a newer change, and the row reads as removed.
    let listeners: ((item: QueueFeedItem) => void)[] = []
    holder.store = {
      ...real,
      subscribe: (listener) => {
        listeners = [...listeners, listener]
        return real.subscribe(listener)
      },
      list: (id) => {
        // The row this change carries is not in the snapshot the store is about
        // to return, which is what makes the order visible.
        for (const listener of listeners) {
          listener({ subChatId, items: [{ id: "buffered" } as QueueItem] })
        }
        return real.list(id)
      },
    } as QueueStore

    const seen: string[][] = []
    const observable = (await caller.subscribe({ subChatId })) as unknown as {
      subscribe: (observer: { next: (value: QueueFeedItem) => void }) => { unsubscribe: () => void }
    }
    const subscription = observable.subscribe({
      next: (value) => seen.push(value.items.map((queued) => queued.id)),
    })
    subscription.unsubscribe()

    expect(seen).toEqual([[], ["buffered"]])
  })

  it("does not feed a window the changes of another sub-chat", async () => {
    const other = seedSubChat(opened.db)
    const seen: QueueFeedItem[] = []
    const observable = (await caller.subscribe({ subChatId })) as unknown as {
      subscribe: (observer: { next: (value: QueueFeedItem) => void }) => { unsubscribe: () => void }
    }
    const subscription = observable.subscribe({ next: (value) => seen.push(value) })

    // A subscriber that named one sub-chat is that sub-chat's card. Another
    // sub-chat's rows would render there.
    await caller.add({ subChatId: other, payload: { message: "elsewhere" } })
    await caller.add({ subChatId, payload: { message: "mine" } })

    expect(seen.map((item) => item.subChatId)).toEqual([subChatId, subChatId])
    subscription.unsubscribe()
  })

  it("leaves no listener behind when the replay fails", async () => {
    const real = holder.store as QueueStore
    let stopped = 0
    holder.store = {
      ...real,
      subscribe: (listener) => {
        const unsubscribe = real.subscribe(listener)
        return () => {
          stopped += 1
          unsubscribe()
        }
      },
      list: () => {
        throw new Error("database is locked")
      },
    } as QueueStore

    const observable = (await caller.subscribe({ subChatId })) as unknown as {
      subscribe: (observer: { next: () => void }) => { unsubscribe: () => void }
    }

    // The failure reaches the caller, and the listener registered just before
    // it is detached: a window that never got a subscription must not keep
    // tapping main's feed for the life of the process.
    expect(() => observable.subscribe({ next: () => {} })).toThrow("database is locked")
    expect(stopped).toBe(1)
  })

  it("refuses a move to a negative index and a claim with no window", async () => {
    const item = await caller.add({ subChatId, payload: { message: "one" } })

    await expect(caller.move({ subChatId, itemId: item.id, index: -1 })).rejects.toThrow()

    // The claiming window is required: it is what main keys a claim by, so a
    // nameless claim could not be handed back when that window closed.
    const namelessClaim = caller.claim as unknown as (input: {
      subChatId: string
    }) => Promise<unknown>
    await expect(namelessClaim({ subChatId })).rejects.toThrow()
  })

  it("completes a claimed item only once", async () => {
    const item = (await caller.claim({
      subChatId: (await caller.add({ subChatId, payload: { message: "one" } })).subChatId,
      owner: WINDOW_A,
    })) as QueueItem
    // The row retires only after the hand-off, which is the order the sender
    // uses: claim, mark handed, send, complete.
    expect(await caller.markHanded({ subChatId, itemId: item.id, owner: WINDOW_A })).toBe(true)

    await expect(caller.complete({ subChatId, itemId: item.id, owner: WINDOW_B })).resolves.toBe(
      false,
    )
    await expect(caller.complete({ subChatId, itemId: item.id, owner: WINDOW_A })).resolves.toBe(
      true,
    )
    await expect(caller.complete({ subChatId, itemId: item.id, owner: WINDOW_A })).resolves.toBe(
      false,
    )
  })
})
