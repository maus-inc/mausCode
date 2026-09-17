/**
 * Queue router tests (roadmap step 08). Exercises the read, write and claim
 * surface through the real tRPC caller against a store backed by a real SQLite
 * test database, including what the far side of the boundary bounds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "../../../../shared/queue-item"
import { migrationsRoot } from "../../db/migrations-path"
import { chats, projects, subChats } from "../../db/schema"
import { migrateTestDb, openTestDb } from "../../db/test-sqlite"
import { createQueueStore, type QueueFeedItem, type QueueStore } from "../../queue/queue-state"
import { queueRouter } from "./queue"

const holder = vi.hoisted(() => ({ store: null as QueueStore | null }))

vi.mock("../../queue", () => ({
  getQueueStore: () => {
    if (!holder.store) throw new Error("test store not initialized")
    return holder.store
  },
}))

type TestDb = ReturnType<typeof openTestDb>

function seedSubChat(db: TestDb["db"]): string {
  const project = db
    .insert(projects)
    .values({ name: "p", path: `/p/${Math.random()}` })
    .returning()
    .get()
  const chat = db.insert(chats).values({ projectId: project.id }).returning().get()
  return db.insert(subChats).values({ chatId: chat.id }).returning().get().id
}

describe("queue router", () => {
  let opened: TestDb
  let subChatId: string
  const caller = queueRouter.createCaller({ getWindow: () => null })

  beforeEach(() => {
    opened = openTestDb()
    migrateTestDb(opened.db, migrationsRoot)
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

    const claimed = await caller.claim({ subChatId })
    expect(claimed?.id).toBe(item.id)

    await expect(caller.claim({ subChatId })).resolves.toBeNull()
  })

  it("stops dispatching while the queue is paused and resumes on an add", async () => {
    await caller.add({ subChatId, payload: { message: "one" } })

    await caller.setPaused({ subChatId, paused: true })
    await expect(caller.claim({ subChatId })).resolves.toBeNull()

    await caller.add({ subChatId, payload: { message: "two" } })
    await expect(caller.claim({ subChatId })).resolves.not.toBeNull()
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
    })) as QueueItem

    await expect(caller.complete({ subChatId, itemId: item.id })).resolves.toBe(true)
    await expect(caller.complete({ subChatId, itemId: item.id })).resolves.toBe(false)
  })
})
