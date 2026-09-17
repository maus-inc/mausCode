/**
 * Queue store tests (roadmap step 08). Runs against a real SQLite database
 * through the node:sqlite adapter, with the generated migrations applied, so
 * the schema and the store are tested together. Every scenario the step names
 * is here: reload with items pending, two windows adding, two windows
 * claiming, move while draining, and a cancel that leaves the queue intact.
 */
import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { QueueItem, QueuePayload } from "../../../shared/queue-item"
import { migrationsRoot } from "../db/migrations-path"
import { chats, projects, queueItems, subChats } from "../db/schema"
import { migrateTestDb, openTestDb } from "../db/test-sqlite"
import { createRunStore, type RunStore } from "../runs/run-state"
import { createQueueStore, POSITION_STEP, type QueueStore } from "./queue-state"

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

function payload(message: string): QueuePayload {
  return { message }
}

function ids(items: QueueItem[]): string[] {
  return items.map((item) => item.id)
}

describe("queue store", () => {
  let opened: TestDb
  let store: QueueStore
  let runStore: RunStore
  let subChatId: string

  beforeEach(() => {
    opened = openTestDb()
    migrateTestDb(opened.db, migrationsRoot)
    store = createQueueStore(opened.db)
    runStore = createRunStore(opened.db)
    subChatId = seedSubChat(opened.db)
  })

  afterEach(() => {
    opened.client.close()
  })

  describe("persistence and ordering", () => {
    it("keeps two pending items in order across a reload", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })

      // A reload is a fresh store over the same database.
      const reloaded = createQueueStore(opened.db)
      const items = reloaded.list(subChatId)

      expect(ids(items)).toEqual([first.id, second.id])
      expect(items.map((item) => item.payload.message)).toEqual(["one", "two"])
      expect(items.map((item) => item.status)).toEqual(["pending", "pending"])
      expect(second.position - first.position).toBe(POSITION_STEP)
    })

    it("gives two windows adding concurrently distinct positions and a stable order", () => {
      const windowA = createQueueStore(opened.db)
      const windowB = createQueueStore(opened.db)

      const fromA = windowA.add({ subChatId, payload: payload("a") })
      const fromB = windowB.add({ subChatId, payload: payload("b") })
      const fromA2 = windowA.add({ subChatId, payload: payload("a2") })

      expect(new Set([fromA.position, fromB.position, fromA2.position]).size).toBe(3)
      expect(ids(store.list(subChatId))).toEqual([fromA.id, fromB.id, fromA2.id])
    })

    it("rejects a payload outside the bounded shape", () => {
      expect(() =>
        store.add({
          subChatId,
          payload: {
            message: "x",
            images: new Array(21).fill({ id: "1", url: "u", mediaType: "m" }),
          },
        }),
      ).toThrowError()
      expect(store.list(subChatId)).toHaveLength(0)
    })
  })

  describe("claim", () => {
    it("hands the head item to exactly one of two windows asking", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      store.add({ subChatId, payload: payload("two") })
      const windowA = createQueueStore(opened.db)
      const windowB = createQueueStore(opened.db)

      const claimed = [windowA.claim({ subChatId }), windowB.claim({ subChatId })]
      const winners = claimed.filter((item): item is QueueItem => item !== null)

      expect(winners).toHaveLength(1)
      expect(winners[0].id).toBe(first.id)
      expect(winners[0].status).toBe("sending")
      expect(winners[0].dispatchedAt).not.toBeNull()
    })

    it("gives the row to one window when two store instances race on one file", () => {
      // The strongest form of the two-window proof available in a unit test: a
      // second SQLite connection, migrated from the same migrations, claiming
      // the same row. The claim guard is the conditional update in the
      // database, so process memory cannot be what decides the winner.
      const file = join(tmpdir(), `mauscode-queue-${randomUUID()}.db`)
      const firstWindow = openTestDb(file)
      const secondWindow = openTestDb(file)
      try {
        migrateTestDb(firstWindow.db, migrationsRoot)
        const sharedSubChatId = seedSubChat(firstWindow.db)
        const firstStore = createQueueStore(firstWindow.db)
        const secondStore = createQueueStore(secondWindow.db)
        firstStore.add({ subChatId: sharedSubChatId, payload: payload("one") })

        const claims = [
          firstStore.claim({ subChatId: sharedSubChatId }),
          secondStore.claim({ subChatId: sharedSubChatId }),
        ]

        expect(claims.filter((item) => item !== null)).toHaveLength(1)
        expect(claims[0]?.payload.message ?? claims[1]?.payload.message).toBe("one")
        expect(firstStore.list(sharedSubChatId)).toHaveLength(1)
        expect(firstStore.list(sharedSubChatId)[0]?.status).toBe("sending")
      } finally {
        firstWindow.client.close()
        secondWindow.client.close()
        rmSync(file, { force: true })
        rmSync(`${file}-wal`, { force: true })
        rmSync(`${file}-shm`, { force: true })
      }
    })

    it("never hands out the same row twice", () => {
      store.add({ subChatId, payload: payload("one") })

      expect(store.claim({ subChatId })?.payload.message).toBe("one")
      expect(store.claim({ subChatId })).toBeNull()
    })

    it("refuses to dispatch while a run is active and dispatches once it settles", () => {
      store.add({ subChatId, payload: payload("one") })
      const handle = runStore.startRun({ subChatId, engine: "legacy" })

      expect(store.claim({ subChatId })).toBeNull()

      handle.noteFinished()
      handle.settle()

      expect(store.claim({ subChatId })?.payload.message).toBe("one")
    })

    it("refuses Send now for a second row while one is already being sent", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      // A window holds the first row while its send is starting.
      expect(store.claim({ subChatId, itemId: first.id })?.id).toBe(first.id)

      // Send now skips the idle gate, but not the one-send-at-a-time rule:
      // two claimed rows would be two turns on one session.
      expect(store.claim({ subChatId, itemId: second.id })).toBeNull()
      expect(store.list(subChatId).filter((item) => item.status === "sending")).toHaveLength(1)
    })

    it("gives the same row back to Send now after the row is put back", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      expect(store.claim({ subChatId, itemId: first.id })?.id).toBe(first.id)
      store.requeue(subChatId, first.id)

      expect(store.claim({ subChatId, itemId: first.id })?.id).toBe(first.id)
    })

    it("claims a specific item for Send now without the idle gate", () => {
      store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      runStore.startRun({ subChatId, engine: "legacy" })

      const claimed = store.claim({ subChatId, itemId: second.id })

      expect(claimed?.id).toBe(second.id)
      expect(store.list(subChatId).filter((item) => item.status === "sending")).toHaveLength(1)
    })

    it("moves an item while another is draining, and dispatches the moved head next", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      const third = store.add({ subChatId, payload: payload("three") })

      expect(store.claim({ subChatId })?.id).toBe(first.id)

      const moved = store.move(subChatId, third.id, 0)

      expect(moved).not.toBeNull()
      // The moved row takes the card's first slot, which in the total order
      // is after the row in flight, and the sending row keeps its place.
      expect(ids(store.list(subChatId))).toEqual([first.id, third.id, second.id])
      expect(ids(store.list(subChatId).filter((item) => item.status !== "sending"))).toEqual([
        third.id,
        second.id,
      ])

      expect(store.complete(subChatId, first.id)).toBe(true)
      expect(store.claim({ subChatId })?.id).toBe(third.id)
    })

    it("renumbers a sub-chat only when the gap between neighbours is gone", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      const third = store.add({ subChatId, payload: payload("three") })
      opened.db.update(queueItems).set({ position: 1 }).where(eq(queueItems.id, first.id)).run()
      opened.db.update(queueItems).set({ position: 2 }).where(eq(queueItems.id, second.id)).run()

      store.move(subChatId, third.id, 1)

      const items = store.list(subChatId)
      expect(ids(items)).toEqual([first.id, third.id, second.id])
      expect(items.map((item) => item.position)).toEqual([
        POSITION_STEP,
        POSITION_STEP * 2,
        POSITION_STEP * 3,
      ])
    })
  })

  describe("pause", () => {
    it("blocks dispatch until an explicit send resumes the queue", () => {
      store.add({ subChatId, payload: payload("one") })
      store.add({ subChatId, payload: payload("two") })

      expect(store.setPaused(subChatId, true)).toBe(2)
      expect(store.claim({ subChatId })).toBeNull()

      expect(store.setPaused(subChatId, false)).toBe(2)
      expect(store.claim({ subChatId })?.payload.message).toBe("one")
    })

    it("resumes on an explicit queue add", () => {
      store.add({ subChatId, payload: payload("one") })
      store.setPaused(subChatId, true)

      store.add({ subChatId, payload: payload("two") })

      expect(store.list(subChatId).map((item) => item.status)).toEqual(["pending", "pending"])
      expect(store.claim({ subChatId })?.payload.message).toBe("one")
    })

    it("claims a paused item for Send now", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      store.setPaused(subChatId, true)

      expect(store.claim({ subChatId, itemId: first.id })?.id).toBe(first.id)
    })
  })

  describe("cancel", () => {
    it("leaves the queue intact when a run is cancelled", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      runStore.startRun({ subChatId, engine: "legacy" })

      expect(runStore.cancelActiveForSubChat(subChatId, "user_cancel")).toBe(true)

      expect(ids(store.list(subChatId))).toEqual([first.id, second.id])
      expect(store.claim({ subChatId })?.id).toBe(first.id)
    })
  })

  describe("send outcomes", () => {
    it("deletes the row on complete and returns it in place on requeue", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })

      expect(store.claim({ subChatId })?.id).toBe(first.id)
      expect(store.requeue(subChatId, first.id)).toBe(true)
      expect(ids(store.list(subChatId))).toEqual([first.id, second.id])
      expect(store.list(subChatId)[0].dispatchedAt).toBeNull()

      expect(store.claim({ subChatId, itemId: first.id })?.id).toBe(first.id)
      expect(store.complete(subChatId, first.id)).toBe(true)
      expect(ids(store.list(subChatId))).toEqual([second.id])
    })

    it("returns a claimed but unsent item to pending on recovery", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      store.claim({ subChatId })

      expect(store.recoverSending()).toBe(1)

      const items = createQueueStore(opened.db).list(subChatId)
      expect(items[0].id).toBe(first.id)
      expect(items[0].status).toBe("pending")
      expect(items[0].dispatchedAt).toBeNull()
    })

    it("clears every row for a sub-chat without touching another", () => {
      const otherSubChatId = seedSubChat(opened.db)
      store.add({ subChatId, payload: payload("one") })
      store.add({ subChatId: otherSubChatId, payload: payload("other") })

      expect(store.clear(subChatId)).toBe(1)

      expect(store.list(subChatId)).toHaveLength(0)
      expect(store.list(otherSubChatId)).toHaveLength(1)
    })
  })

  describe("subscribe", () => {
    it("emits the changed list and survives a throwing listener", () => {
      const seen: string[][] = []
      const stopBroken = store.subscribe(() => {
        throw new Error("listener down")
      })
      const stop = store.subscribe((item) => {
        seen.push(ids(item.items))
      })

      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      const claimed = store.claim({ subChatId })
      if (claimed) store.complete(subChatId, claimed.id)

      expect(seen[0]).toEqual([first.id])
      expect(seen[1]).toEqual([first.id, second.id])
      expect(seen.at(-1)).toEqual([second.id])
      stop()
      stopBroken()
    })
  })
})
