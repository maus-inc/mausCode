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
import { queueItems, runs } from "../db/schema"
import { openMigratedTestDb, seedSubChat, type TestDb } from "../db/test-fixtures"
import { migrateTestDb, openTestDb } from "../db/test-sqlite"
import { createRunStore, type RunStore } from "../runs/run-state"
import { CLAIM_LEASE_MS, createQueueStore, POSITION_STEP, type QueueStore } from "./queue-state"

function payload(message: string): QueuePayload {
  return { message }
}

function ids(items: QueueItem[]): string[] {
  return items.map((item) => item.id)
}

/** The two window sessions these tests act as. */
const WINDOW_A = "session-a"
const WINDOW_B = "session-b"

function claim(
  store: QueueStore,
  subChatId: string,
  itemId?: string,
  owner: string = WINDOW_A,
): QueueItem | null {
  return store.claim({ subChatId, itemId, owner })
}

/**
 * Move a claim's clock past its lease, which is what a renderer crash or a
 * reload does from the store's point of view: nobody came back to hand the
 * payload over.
 */
function ageClaim(db: TestDb["db"], itemId: string, ms = CLAIM_LEASE_MS + 1000): void {
  db.update(queueItems)
    .set({ dispatchedAt: new Date(Date.now() - ms) })
    .where(eq(queueItems.id, itemId))
    .run()
}

describe("queue store", () => {
  let opened: TestDb
  let store: QueueStore
  let runStore: RunStore
  let subChatId: string

  beforeEach(() => {
    opened = openMigratedTestDb()
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

      // The order the reload reads is the rows' own, not the order they were
      // inserted in: with the two items sharing a creation millisecond, only a
      // move makes that visible, and it has to survive the reload too.
      store.move(subChatId, second.id, 0)
      const moved = createQueueStore(opened.db).list(subChatId)
      expect(ids(moved)).toEqual([second.id, first.id])
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

    it("rejects the attachments of one item when their total passes the cap", () => {
      const big = "A".repeat(24_000_000)
      expect(() =>
        store.add({
          subChatId,
          payload: {
            message: "x",
            images: [
              { id: "1", url: "u", mediaType: "m", base64Data: big },
              { id: "2", url: "u", mediaType: "m", base64Data: big },
              { id: "3", url: "u", mediaType: "m", base64Data: big },
            ],
          },
        }),
      ).toThrowError(/base64/)
      expect(store.list(subChatId)).toHaveLength(0)
    })
  })

  describe("claim", () => {
    it("hands the head item to exactly one of two windows asking", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      store.add({ subChatId, payload: payload("two") })
      const windowA = createQueueStore(opened.db)
      const windowB = createQueueStore(opened.db)

      const claimed = [
        claim(windowA, subChatId, undefined, WINDOW_A),
        claim(windowB, subChatId, undefined, WINDOW_B),
      ]
      const winners = claimed.filter((item): item is QueueItem => item !== null)

      expect(winners).toHaveLength(1)
      expect(winners[0].id).toBe(first.id)
      expect(winners[0].status).toBe("sending")
      expect(winners[0].dispatchedAt).not.toBeNull()
    })

    it("keeps a handed-over row away from a second window, and a window that hands it over cannot hand it over twice", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const windowA = createQueueStore(opened.db)

      expect(claim(windowA, subChatId, undefined, WINDOW_A)?.id).toBe(first.id)
      expect(windowA.markHanded(subChatId, first.id, WINDOW_A)).toBe(true)
      // Same owner twice: the marker is a latch, not a counter.
      expect(windowA.markHanded(subChatId, first.id, WINDOW_A)).toBe(false)
      // Another window may not take a claim that reached the engine.
      expect(claim(store, subChatId, undefined, WINDOW_B)).toBeNull()
      // Nor may it hand it over as if it owned it.
      expect(store.markHanded(subChatId, first.id, WINDOW_B)).toBe(false)
      expect(store.list(subChatId)[0]?.status).toBe("sending")
    })

    it("refuses a second window while a claim is live, not handed over yet", () => {
      // The window is between the claim and the hand-off, which is a real
      // moment in the Send now path while it stops the turn in flight.
      const first = store.add({ subChatId, payload: payload("one") })
      expect(claim(store, subChatId, undefined, WINDOW_A)?.id).toBe(first.id)

      expect(claim(store, subChatId, undefined, WINDOW_B)).toBeNull()
    })

    it("refuses another window that asks for a row by id while it is being sent", () => {
      // The case the claim's where clause exists for. A row in flight is
      // skipped by the busy check above it (the read names the same row), so
      // nothing but the conditional update stands between a second window's
      // Send now — a stale card, or an impatient second click — and taking a
      // message away from the window that is already sending it.
      const first = store.add({ subChatId, payload: payload("one") })
      expect(claim(store, subChatId, first.id, WINDOW_A)?.id).toBe(first.id)

      expect(claim(store, subChatId, first.id, WINDOW_B)).toBeNull()
      // Still window A's row, still `sending`: nothing about the loser's ask
      // touched it.
      const row = store.list(subChatId)[0]
      expect(row.status).toBe("sending")
      expect(row.id).toBe(first.id)

      // The same holds after the hand-off, when the message may be in the
      // engine: a second window may not take it over.
      expect(store.markHanded(subChatId, first.id, WINDOW_A)).toBe(true)
      expect(claim(store, subChatId, first.id, WINDOW_B)).toBeNull()
      expect(store.list(subChatId)[0].status).toBe("sending")
    })

    it("puts a claim back once its lease runs out, so a dead renderer cannot stall the queue", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const deadWindow = createQueueStore(opened.db)
      expect(claim(deadWindow, subChatId, undefined, WINDOW_A)?.id).toBe(first.id)
      // The renderer died between the claim and the hand-off, so the payload
      // was never given to the engine. The window is not closed, so nothing
      // tells main to release it: the lease is what does.
      ageClaim(opened.db, first.id)
      const survivor = createQueueStore(opened.db)

      const takenOver = claim(survivor, subChatId, undefined, WINDOW_B)

      expect(takenOver?.id).toBe(first.id)
      expect(takenOver?.status).toBe("sending")
      // The dead window must not send now: it lost the row.
      expect(deadWindow.markHanded(subChatId, first.id, WINDOW_A)).toBe(false)
      // And the survivor can.
      expect(survivor.markHanded(subChatId, first.id, WINDOW_B)).toBe(true)
    })

    it("parks a handed claim of the same window and moves on to the next item", () => {
      // Same window, no live session: a reload between the hand-off and the
      // bookkeeping. Nobody can say whether the engine took it, so it is not
      // sent again, and the rest of the queue does not wait behind it.
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      const beforeReload = createQueueStore(opened.db)
      expect(claim(beforeReload, subChatId, undefined, WINDOW_A)?.id).toBe(first.id)
      expect(beforeReload.markHanded(subChatId, first.id, WINDOW_A)).toBe(true)

      const afterReload = createQueueStore(opened.db)
      const next = claim(afterReload, subChatId, undefined, WINDOW_A)

      expect(next?.id).toBe(second.id)
      const parked = afterReload.list(subChatId).find((item) => item.id === first.id)
      expect(parked?.status).toBe("paused")
    })

    it("does not let a handed claim of another window be parked by this one", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      store.add({ subChatId, payload: payload("two") })
      expect(claim(store, subChatId, undefined, WINDOW_A)?.id).toBe(first.id)
      expect(store.markHanded(subChatId, first.id, WINDOW_A)).toBe(true)

      // WINDOW_B has no way to know whether WINDOW_A is still alive.
      expect(claim(store, subChatId, undefined, WINDOW_B)).toBeNull()
      expect(store.list(subChatId).find((item) => item.id === first.id)?.status).toBe("sending")
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
          claim(firstStore, sharedSubChatId, undefined, WINDOW_A),
          claim(secondStore, sharedSubChatId, undefined, WINDOW_B),
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

    it("keeps the second window out in the gap before the run row exists", () => {
      // The claim and the run row are two writes on purpose: the window that
      // holds the claim creates the run when its turn starts. What makes that
      // gap safe is the conditional `pending -> sending` update in this store,
      // not an atomic pair, so the gap itself is what this test pins.
      const file = join(tmpdir(), `mauscode-queue-gap-${randomUUID()}.db`)
      const firstWindow = openTestDb(file)
      const secondWindow = openTestDb(file)
      try {
        migrateTestDb(firstWindow.db, migrationsRoot)
        const sharedSubChatId = seedSubChat(firstWindow.db)
        const firstStore = createQueueStore(firstWindow.db)
        const secondStore = createQueueStore(secondWindow.db)
        const row = firstStore.add({ subChatId: sharedSubChatId, payload: payload("one") })

        expect(claim(firstStore, sharedSubChatId)?.id).toBe(row.id)
        // Nothing has started a turn yet, so no run row exists anywhere.
        expect(
          firstWindow.db.select().from(runs).where(eq(runs.subChatId, sharedSubChatId)).all(),
        ).toEqual([])
        // The winner is still the only one that may send.
        expect(claim(secondStore, sharedSubChatId)).toBeNull()

        // The winner's turn starts, its run row lands, and the row retires.
        const handle = createRunStore(firstWindow.db).startRun({
          subChatId: sharedSubChatId,
          engine: "legacy",
        })
        expect(firstStore.complete(sharedSubChatId, row.id, WINDOW_A)).toBe(true)
        handle.noteFinished()
        handle.settle()

        // Only now does the next item become claimable.
        const next = secondStore.add({ subChatId: sharedSubChatId, payload: payload("two") })
        expect(claim(secondStore, sharedSubChatId)?.id).toBe(next.id)
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

      expect(claim(store, subChatId)?.payload.message).toBe("one")
      expect(claim(store, subChatId)).toBeNull()
    })

    it("refuses to dispatch while a run is active and dispatches once it settles", () => {
      store.add({ subChatId, payload: payload("one") })
      const handle = runStore.startRun({ subChatId, engine: "legacy" })

      expect(claim(store, subChatId)).toBeNull()

      handle.noteFinished()
      handle.settle()

      expect(claim(store, subChatId)?.payload.message).toBe("one")
    })

    it("refuses Send now for a second row while one is already being sent", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      // A window holds the first row while its send is starting.
      expect(claim(store, subChatId, first.id)?.id).toBe(first.id)

      // Send now skips the idle gate, but not the one-send-at-a-time rule:
      // two claimed rows would be two turns on one session.
      expect(claim(store, subChatId, second.id)).toBeNull()
      expect(store.list(subChatId).filter((item) => item.status === "sending")).toHaveLength(1)
    })

    it("gives the same row back to Send now after the row is put back", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      expect(claim(store, subChatId, first.id)?.id).toBe(first.id)
      store.requeue(subChatId, first.id, WINDOW_A)

      expect(claim(store, subChatId, first.id)?.id).toBe(first.id)
    })

    it("claims a specific item for Send now without the idle gate", () => {
      store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      runStore.startRun({ subChatId, engine: "legacy" })

      const claimed = claim(store, subChatId, second.id)

      expect(claimed?.id).toBe(second.id)
      expect(store.list(subChatId).filter((item) => item.status === "sending")).toHaveLength(1)
    })

    it("moves an item while another is draining, and dispatches the moved head next", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      const third = store.add({ subChatId, payload: payload("three") })

      expect(claim(store, subChatId)?.id).toBe(first.id)

      const moved = store.move(subChatId, third.id, 0)

      expect(moved).not.toBeNull()
      // The moved row takes the card's first slot, which in the total order
      // is after the row in flight, and the sending row keeps its place.
      expect(ids(store.list(subChatId))).toEqual([first.id, third.id, second.id])
      expect(ids(store.list(subChatId).filter((item) => item.status !== "sending"))).toEqual([
        third.id,
        second.id,
      ])

      expect(store.complete(subChatId, first.id, WINDOW_A)).toBe(true)
      expect(claim(store, subChatId)?.id).toBe(third.id)
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
      expect(claim(store, subChatId)).toBeNull()

      expect(store.setPaused(subChatId, false)).toBe(2)
      expect(claim(store, subChatId)?.payload.message).toBe("one")
    })

    it("resumes on an explicit queue add", () => {
      store.add({ subChatId, payload: payload("one") })
      store.setPaused(subChatId, true)

      store.add({ subChatId, payload: payload("two") })

      expect(store.list(subChatId).map((item) => item.status)).toEqual(["pending", "pending"])
      expect(claim(store, subChatId)?.payload.message).toBe("one")
    })

    it("claims a paused item for Send now", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      store.setPaused(subChatId, true)

      expect(claim(store, subChatId, first.id)?.id).toBe(first.id)
    })

    it("holds a row that came back while the user's stop still stands", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      store.add({ subChatId, payload: payload("two") })
      expect(store.setPaused(subChatId, true)).toBe(2)

      // Send now claims a held row — an explicit ask may — and the send fails
      // before the hand-off, so the row goes back to the queue. `pending` is
      // the only status that means "waiting", so it comes back as one even
      // though the stop is still the user's answer.
      expect(claim(store, subChatId, first.id)?.id).toBe(first.id)
      expect(store.requeue(subChatId, first.id, WINDOW_A)).toBe(true)
      expect(store.list(subChatId)[0].status).toBe("pending")

      // The automatic path must not take it: the pause is per sub-chat, not per
      // row, so one row's return does not overrule the stop.
      expect(claim(store, subChatId)).toBeNull()

      // An explicit resume is what lifts it, and then the row goes.
      expect(store.setPaused(subChatId, false)).toBe(1)
      expect(claim(store, subChatId)?.id).toBe(first.id)
    })
  })

  describe("cancel", () => {
    it("leaves the queue intact when a run is cancelled", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      runStore.startRun({ subChatId, engine: "legacy" })

      expect(runStore.cancelActiveForSubChat(subChatId, "user_cancel")).toBe(true)

      expect(ids(store.list(subChatId))).toEqual([first.id, second.id])
      expect(claim(store, subChatId)?.id).toBe(first.id)
    })
  })

  describe("send outcomes", () => {
    it("deletes the row on complete and returns it in place on requeue", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })

      expect(claim(store, subChatId)?.id).toBe(first.id)
      expect(store.requeue(subChatId, first.id, WINDOW_A)).toBe(true)
      expect(ids(store.list(subChatId))).toEqual([first.id, second.id])
      expect(store.list(subChatId)[0].dispatchedAt).toBeNull()

      expect(claim(store, subChatId, first.id)?.id).toBe(first.id)
      expect(store.complete(subChatId, first.id, WINDOW_A)).toBe(true)
      expect(ids(store.list(subChatId))).toEqual([second.id])
    })

    it("returns a claimed but unsent item to pending on recovery", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      claim(store, subChatId)

      expect(store.recoverSending()).toBe(1)

      const items = createQueueStore(opened.db).list(subChatId)
      expect(items[0].id).toBe(first.id)
      expect(items[0].status).toBe("pending")
      expect(items[0].dispatchedAt).toBeNull()
    })

    it("splits recovery by the hand-off when both kinds of row are waiting", () => {
      // One database, two sub-chats: one row was handed to the engine, the
      // other was claimed and never left. Recovery reads them in one pass, and
      // each half of the split has its own where clause — a query that matched
      // both is only visible when both are in front of it.
      const handedSubChatId = seedSubChat(opened.db)
      const neverHandedSubChatId = seedSubChat(opened.db)
      const handed = store.add({ subChatId: handedSubChatId, payload: payload("handed") })
      const neverHanded = store.add({
        subChatId: neverHandedSubChatId,
        payload: payload("never handed"),
      })
      expect(claim(store, handedSubChatId, handed.id, WINDOW_A)?.id).toBe(handed.id)
      expect(store.markHanded(handedSubChatId, handed.id, WINDOW_A)).toBe(true)
      expect(claim(store, neverHandedSubChatId, neverHanded.id, WINDOW_B)?.id).toBe(neverHanded.id)

      expect(createQueueStore(opened.db).recoverSending()).toBe(2)

      // The handed row may already be in the engine, so it is held as paused;
      // the row that never left goes back to the queue and dispatches.
      expect(store.list(handedSubChatId)[0].status).toBe("paused")
      expect(claim(store, handedSubChatId)).toBeNull()
      expect(store.list(neverHandedSubChatId)[0].status).toBe("pending")
      expect(claim(store, neverHandedSubChatId)?.id).toBe(neverHanded.id)
    })

    it("holds a handed-over row as paused on recovery, and lets the queue past it", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      const second = store.add({ subChatId, payload: payload("two") })
      const interrupted = createQueueStore(opened.db)
      expect(claim(interrupted, subChatId, undefined, WINDOW_A)?.id).toBe(first.id)
      expect(interrupted.markHanded(subChatId, first.id, WINDOW_A)).toBe(true)

      // The app comes back. The message may be in the engine, so it is not
      // sent again, and it is not a stop either: the next item dispatches.
      expect(createQueueStore(opened.db).recoverSending()).toBe(1)
      const items = store.list(subChatId)
      expect(items.find((item) => item.id === first.id)?.status).toBe("paused")
      expect(claim(store, subChatId)?.id).toBe(second.id)
    })

    it("keeps a parked row out of the automatic path when the queue resumes", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      expect(claim(store, subChatId, first.id)?.id).toBe(first.id)
      expect(store.markHanded(subChatId, first.id, WINDOW_A)).toBe(true)
      expect(store.park(subChatId, first.id, WINDOW_A)).toBe(true)

      // Resume is about the rows a user stop held back; a parked row already
      // left for the engine, so it stays where the user can decide about it.
      store.setPaused(subChatId, false)

      expect(store.list(subChatId)[0].status).toBe("paused")
    })

    it("keeps a parked row out of the automatic path when the user queues another message", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      expect(claim(store, subChatId, first.id)?.id).toBe(first.id)
      expect(store.markHanded(subChatId, first.id, WINDOW_A)).toBe(true)
      expect(store.park(subChatId, first.id, WINDOW_A)).toBe(true)

      // Queueing is an explicit send, so it ends a user pause. A parked row is
      // not a pause: it already left for the engine, so it must stay put.
      store.add({ subChatId, payload: payload("two") })

      const items = store.list(subChatId)
      expect(items.find((item) => item.id === first.id)?.status).toBe("paused")
      // The row the user just queued still dispatches, past the parked one.
      expect(claim(store, subChatId)?.payload.message).toBe("two")
    })

    it("refuses to requeue a row that another window claimed", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      expect(claim(store, subChatId, first.id, WINDOW_A)?.id).toBe(first.id)

      // The write is owner-scoped like the hand-off: a window cannot release a
      // claim it does not hold, which is what would let the row be sent twice.
      expect(store.requeue(subChatId, first.id, WINDOW_B)).toBe(false)
      expect(store.list(subChatId)[0].status).toBe("sending")

      expect(store.requeue(subChatId, first.id, WINDOW_A)).toBe(true)
      expect(store.list(subChatId)[0].status).toBe("pending")
    })

    it("refuses to requeue a row that was already handed over", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      expect(claim(store, subChatId, first.id)?.id).toBe(first.id)
      expect(store.markHanded(subChatId, first.id, WINDOW_A)).toBe(true)

      // The message may be in the engine, so the only thing that may touch this
      // row is the park that says so.
      expect(store.requeue(subChatId, first.id, WINDOW_A)).toBe(false)
      expect(store.list(subChatId)[0].status).toBe("sending")
      expect(store.park(subChatId, first.id, WINDOW_A)).toBe(true)
    })

    it("refuses to park or complete a row another window claimed", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      expect(claim(store, subChatId, first.id, WINDOW_A)?.id).toBe(first.id)
      expect(store.markHanded(subChatId, first.id, WINDOW_A)).toBe(true)

      // A stale card in another window, or a second window clicking on a row
      // this one is already sending, must not be able to take the row away from
      // the only window that can still record what happened to it: parking it
      // would make the sender's own `complete` fail, and the user would then be
      // offered a message that may already have been sent.
      expect(store.park(subChatId, first.id, WINDOW_B)).toBe(false)
      expect(store.complete(subChatId, first.id, WINDOW_B)).toBe(false)
      expect(store.list(subChatId)[0].status).toBe("sending")

      // The row is still the claiming window's to settle, both ways.
      expect(store.park(subChatId, first.id, WINDOW_A)).toBe(true)
    })

    it("refuses a complete from a window that does not hold the claim", () => {
      const first = store.add({ subChatId, payload: payload("one") })
      expect(claim(store, subChatId, first.id, WINDOW_A)?.id).toBe(first.id)

      expect(store.complete(subChatId, first.id, WINDOW_B)).toBe(false)
      expect(store.list(subChatId)).toHaveLength(1)

      expect(store.complete(subChatId, first.id, WINDOW_A)).toBe(true)
      expect(store.list(subChatId)).toEqual([])
    })

    it("hands back what a closed window held", () => {
      const dead = createQueueStore(opened.db)
      // One sub-chat where it never handed the payload over, one where it did.
      const handedSubChatId = seedSubChat(opened.db)
      const unSentSubChatId = seedSubChat(opened.db)
      const handedRow = store.add({ subChatId: handedSubChatId, payload: payload("sent") })
      const unSentRow = store.add({ subChatId: unSentSubChatId, payload: payload("unsent") })
      expect(claim(dead, handedSubChatId, handedRow.id, WINDOW_A)?.id).toBe(handedRow.id)
      expect(dead.markHanded(handedSubChatId, handedRow.id, WINDOW_A)).toBe(true)
      expect(claim(dead, unSentSubChatId, unSentRow.id, WINDOW_A)?.id).toBe(unSentRow.id)
      // A claim of another window, which the release must leave alone.
      const otherSubChatId = seedSubChat(opened.db)
      const other = store.add({ subChatId: otherSubChatId, payload: payload("other") })
      expect(claim(dead, otherSubChatId, other.id, WINDOW_B)?.id).toBe(other.id)

      expect(dead.releaseOwner(WINDOW_A)).toBe(2)

      expect(store.list(handedSubChatId)[0].status).toBe("paused")
      expect(store.list(unSentSubChatId)[0].status).toBe("pending")
      expect(store.list(otherSubChatId)[0].status).toBe("sending")
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
      const claimed = claim(store, subChatId)
      if (claimed) store.complete(subChatId, claimed.id, WINDOW_A)

      expect(seen[0]).toEqual([first.id])
      expect(seen[1]).toEqual([first.id, second.id])
      expect(seen.at(-1)).toEqual([second.id])
      stop()
      stopBroken()
    })

    it("announces every write, because a card is fed only by the feed", () => {
      // No card is updated optimistically: the window that clicks X, drags a
      // row or stops the queue waits for the feed to tell it what happened, and
      // so does every other window. A write that does not reach the feed leaves
      // every card in the app showing the queue as it was.
      const announced = new Map<string, string[][]>()
      const stop = store.subscribe((item) => {
        const lists = announced.get(item.subChatId) ?? []
        lists.push(ids(item.items))
        announced.set(item.subChatId, lists)
      })

      /** Run one write against a sub-chat of its own and read what it said. */
      const feedOf = (
        write: (ctx: { subChatId: string; itemId: string }) => void,
      ): { rowId: string; said: string[][] } => {
        const subChatId = seedSubChat(opened.db)
        const row = store.add({ subChatId, payload: payload("queued") })
        announced.set(subChatId, [])
        write({ subChatId, itemId: row.id })
        return { rowId: row.id, said: announced.get(subChatId) ?? [] }
      }

      // The row leaves the card, and the deletion is what says so.
      const removed = feedOf(({ subChatId, itemId }) => store.remove(subChatId, itemId))
      expect(removed.said).toEqual([[]])

      const cleared = feedOf(({ subChatId }) => store.clear(subChatId))
      expect(cleared.said).toEqual([[]])

      // A move changes the order the card renders.
      const moved = feedOf(({ subChatId, itemId }) => store.move(subChatId, itemId, 0))
      expect(moved.said).toEqual([[moved.rowId]])

      // A pause changes the row's status, which the card shows.
      const paused = feedOf(({ subChatId }) => store.setPaused(subChatId, true))
      expect(paused.said).toEqual([[paused.rowId]])

      // Every write after a claim announces too, and each on its own: two
      // entries for a claim that is handed over, one more when it is parked,
      // and a second one when it retires.
      const claimed = feedOf(({ subChatId, itemId }) => {
        claim(store, subChatId, itemId, WINDOW_A)
      })
      expect(claimed.said).toEqual([[claimed.rowId]])

      // `markHanded` is the one write that says nothing, on purpose: the row is
      // `sending` before and after, and a `sending` row is hidden from every
      // card and counted the same either way, so there is nothing for a window
      // to redraw. `handedAt` is read only by this store (recovery, and the
      // claim that parks its own handed row), never by a projection.
      const handed = feedOf(({ subChatId, itemId }) => {
        claim(store, subChatId, itemId, WINDOW_A)
        store.markHanded(subChatId, itemId, WINDOW_A)
      })
      expect(handed.said).toEqual([[handed.rowId]])

      const parked = feedOf(({ subChatId, itemId }) => {
        claim(store, subChatId, itemId, WINDOW_A)
        store.markHanded(subChatId, itemId, WINDOW_A)
        store.park(subChatId, itemId, WINDOW_A)
      })
      // The park is what a card shows: the row comes back visible, held.
      expect(parked.said).toEqual([[parked.rowId], [parked.rowId]])

      const completed = feedOf(({ subChatId, itemId }) => {
        claim(store, subChatId, itemId, WINDOW_A)
        store.complete(subChatId, itemId, WINDOW_A)
      })
      expect(completed.said).toEqual([[completed.rowId], []])

      const requeued = feedOf(({ subChatId, itemId }) => {
        claim(store, subChatId, itemId, WINDOW_A)
        store.requeue(subChatId, itemId, WINDOW_A)
      })
      expect(requeued.said).toEqual([[requeued.rowId], [requeued.rowId]])

      stop()
    })
  })
})
