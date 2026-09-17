/**
 * Queue router tests (roadmap step 08). Exercises the read, write and claim
 * surface through the real tRPC caller against a store backed by a real SQLite
 * test database, including what the far side of the boundary bounds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "../../../../shared/queue-item"
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

  it("rejects a payload past the cap the boundary owns", async () => {
    await expect(
      caller.add({ subChatId, payload: { message: "x", pastedTexts: [] } }),
    ).resolves.toBeDefined()
    await expect(
      caller.add({
        subChatId,
        payload: { message: "x".repeat(400_001) },
      }),
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

    await expect(caller.park({ subChatId, itemId: first.id })).resolves.toBe(true)
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
    await expect(caller.list({ subChatId })).resolves.toHaveLength(1)

    await expect(caller.clear({ subChatId })).resolves.toBe(1)
    await expect(caller.list({ subChatId })).resolves.toHaveLength(0)
    expect(second.id).toBeDefined()
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

  it("completes a claimed item only once", async () => {
    const item = (await caller.claim({
      subChatId: (await caller.add({ subChatId, payload: { message: "one" } })).subChatId,
      owner: WINDOW_A,
    })) as QueueItem

    await expect(caller.complete({ subChatId, itemId: item.id })).resolves.toBe(true)
    await expect(caller.complete({ subChatId, itemId: item.id })).resolves.toBe(false)
  })
})
