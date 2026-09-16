/**
 * Runs router tests (roadmap step 07). Exercises get, list and the
 * subscription replay through the real tRPC caller against a store backed by
 * a real SQLite test database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migrationsRoot } from "../../db/migrations-path"
import { chats, projects, subChats } from "../../db/schema"
import { migrateTestDb, openTestDb } from "../../db/test-sqlite"
import { createRunStore, type RunStore } from "../../runs/run-state"
import { type RunsFeedItem, runsRouter } from "./runs"

const holder = vi.hoisted(() => ({ store: null as RunStore | null }))

vi.mock("../../runs", () => ({
  getRunStore: () => {
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

describe("runs router", () => {
  let opened: TestDb
  const caller = runsRouter.createCaller({ getWindow: () => null })

  beforeEach(() => {
    opened = openTestDb()
    migrateTestDb(opened.db, migrationsRoot)
    holder.store = createRunStore(opened.db)
  })

  afterEach(() => {
    holder.store = null
    opened.client.close()
  })

  it("get returns the run and events past the cursor", () => {
    const store = holder.store as RunStore
    const subChatId = seedSubChat(opened.db)
    const handle = store.startRun({ subChatId, engine: "legacy" })
    handle.noteStarted()
    handle.noteFinished()
    handle.settle()

    return caller.get({ runId: handle.runId, afterSeq: 1 }).then((result) => {
      expect(result?.run.id).toBe(handle.runId)
      expect(result?.events.map((event) => event.kind)).toEqual(["started", "settled"])
    })
  })

  it("list filters active runs", async () => {
    const store = holder.store as RunStore
    const subChatId = seedSubChat(opened.db)
    const done = store.startRun({ subChatId, engine: "legacy" })
    done.noteFinished()
    done.settle()
    store.startRun({ subChatId, engine: "legacy" })

    const all = await caller.list({ subChatId })
    expect(all).toHaveLength(2)
    const active = await caller.list({ activeOnly: true })
    expect(active).toHaveLength(1)
    expect(active[0].status).toBe("running")
  })

  it("subscribe emits a snapshot per active run, then live events", async () => {
    const store = holder.store as RunStore
    const subChatId = seedSubChat(opened.db)
    const handle = store.startRun({ subChatId, engine: "legacy" })

    const items: RunsFeedItem[] = []
    const observable = (await caller.subscribe({})) as unknown as {
      subscribe: (observer: { next: (value: RunsFeedItem) => void }) => { unsubscribe: () => void }
    }
    const subscription = observable.subscribe({ next: (item) => items.push(item) })

    // Snapshot of the active run arrived on open.
    expect(items).toHaveLength(1)
    expect(items[0].run.id).toBe(handle.runId)
    expect(items[0].event).toBeNull()

    handle.noteFinished()
    handle.settle()

    const settled = items.find((item) => item.event?.kind === "settled")
    expect(settled?.run.status).toBe("completed")
    subscription.unsubscribe()
  })

  it("subscribe with a sub-chat cursor replays missed events", async () => {
    const store = holder.store as RunStore
    const subChatId = seedSubChat(opened.db)
    const handle = store.startRun({ subChatId, engine: "legacy" })
    handle.noteStarted()
    handle.noteApprovalRequested("Bash")

    const items: RunsFeedItem[] = []
    const observable = (await caller.subscribe({
      subChatId,
      afterSeq: 1,
      runId: handle.runId,
    })) as unknown as {
      subscribe: (observer: { next: (value: RunsFeedItem) => void }) => { unsubscribe: () => void }
    }
    const subscription = observable.subscribe({ next: (item) => items.push(item) })

    expect(items.map((item) => item.event?.kind)).toEqual(["started", "approval_requested"])
    expect(items.map((item) => item.event?.seq)).toEqual([2, 3])

    // The consumer missed nothing after disconnecting and reconnecting at
    // the new cursor.
    subscription.unsubscribe()
    handle.noteApprovalResolved(true)
    const resumed: RunsFeedItem[] = []
    const second = (await caller.subscribe({
      subChatId,
      afterSeq: 3,
      runId: handle.runId,
    })) as unknown as {
      subscribe: (observer: { next: (value: RunsFeedItem) => void }) => { unsubscribe: () => void }
    }
    const secondSubscription = second.subscribe({ next: (item) => resumed.push(item) })
    secondSubscription.unsubscribe()
    expect(resumed.map((item) => item.event?.kind)).toEqual(["approval_resolved"])
  })

  it("a cursor from an older run replays a snapshot of the newest run", async () => {
    const store = holder.store as RunStore
    const subChatId = seedSubChat(opened.db)
    const older = store.startRun({ subChatId, engine: "legacy" })
    older.noteStarted()
    older.noteFinished()
    older.settle()
    const newer = store.startRun({ subChatId, engine: "legacy" })
    newer.noteStarted()

    const items: RunsFeedItem[] = []
    const observable = (await caller.subscribe({
      subChatId,
      afterSeq: 2,
      runId: older.runId,
    })) as unknown as {
      subscribe: (observer: { next: (value: RunsFeedItem) => void }) => { unsubscribe: () => void }
    }
    const subscription = observable.subscribe({ next: (item) => items.push(item) })

    // The old cursor cannot suppress the new run's events; the consumer gets
    // the newest run as a snapshot instead.
    expect(items).toHaveLength(1)
    expect(items[0].run.id).toBe(newer.runId)
    expect(items[0].event).toBeNull()
    subscription.unsubscribe()
  })

  it("a failed replay releases its listener instead of leaking it", async () => {
    const store = holder.store as RunStore
    seedSubChat(opened.db)
    let activeListeners = 0
    const realSubscribe = store.subscribe.bind(store)
    holder.store = {
      ...store,
      subscribe: (onItem, filter) => {
        activeListeners += 1
        const off = realSubscribe(onItem, filter)
        return () => {
          activeListeners -= 1
          off()
        }
      },
    }

    // A closed database makes the replay reads throw during setup.
    opened.client.close()
    opened = openTestDb() // keep afterEach close() valid

    const observable = (await caller.subscribe({})) as unknown as {
      subscribe: (observer: { next: () => void; error?: (error: unknown) => void }) => {
        unsubscribe: () => void
      }
    }
    let errored = false
    let handle: { unsubscribe: () => void } | null = null
    try {
      handle = observable.subscribe({
        next: () => {},
        error: () => {
          errored = true
        },
      })
    } catch {
      errored = true
    }
    handle?.unsubscribe()
    expect(errored).toBe(true)
    expect(activeListeners).toBe(0)
  })

  it("two subscribers both receive the same live event", async () => {
    const store = holder.store as RunStore
    const subChatId = seedSubChat(opened.db)

    const first: RunsFeedItem[] = []
    const second: RunsFeedItem[] = []
    const observable = (await caller.subscribe({ subChatId })) as unknown as {
      subscribe: (observer: { next: (value: RunsFeedItem) => void }) => { unsubscribe: () => void }
    }
    const stopFirst = observable.subscribe({ next: (item) => first.push(item) })
    const stopSecond = observable.subscribe({ next: (item) => second.push(item) })

    const handle = store.startRun({ subChatId, engine: "legacy" })
    handle.noteFinished()
    handle.settle()

    expect(first.map((item) => item.event?.kind)).toEqual(second.map((item) => item.event?.kind))
    expect(first.some((item) => item.event?.kind === "settled")).toBe(true)
    stopFirst.unsubscribe()
    stopSecond.unsubscribe()
  })
})
