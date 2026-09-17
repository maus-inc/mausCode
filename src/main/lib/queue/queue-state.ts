/**
 * Queue store, owned by the main process (roadmap step 08).
 *
 * One `queue_items` row per queued message per sub-chat, ordered by a gapped
 * `position`. This store owns the order and the hand-off: `claim` is the only
 * way a window receives an item, it reads the queue and the run table in one
 * transaction, and it flips the row to `sending` under a
 * `WHERE status = 'pending'` guard, so two windows racing resolve to exactly
 * one winner. The window that wins performs the send with its own transport,
 * because the prompt and the per-chat settings are assembled there.
 *
 * Design contract: `.dump/app/plans/2026-09-17-queue-in-main.md`.
 * Dependencies are injected: tests pass a database opened by
 * `src/main/lib/db/test-sqlite.ts`. The main-process singleton lives in
 * `./index.ts` so this module stays free of Electron imports.
 */
import { and, asc, eq, inArray, max } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import {
  type QueueItem,
  type QueueItemStatus,
  type QueuePayload,
  queuePayloadSchema,
} from "../../../shared/queue-item"
import { ACTIVE_RUN_STATUSES } from "../../../shared/run-state"
import * as schema from "../db/schema"
import { createId } from "../db/utils"

type QueueDb = BetterSQLite3Database<typeof schema>
type QueueTx = QueueDb["transaction"] extends (fn: (tx: infer T) => unknown) => unknown ? T : never
type QueueItemRow = schema.QueueItemRow

/** Gap between two positions, so an insert never rewrites another row. */
export const POSITION_STEP = 1024

export interface QueueFeedItem {
  subChatId: string
  items: QueueItem[]
}

export interface AddQueueItemInput {
  subChatId: string
  payload: QueuePayload
}

export interface ClaimQueueItemInput {
  subChatId: string
  /** Send now: claim this exact row and skip the idle gate. */
  itemId?: string
}

export interface QueueStore {
  add(input: AddQueueItemInput): QueueItem
  remove(subChatId: string, itemId: string): boolean
  clear(subChatId: string): number
  move(subChatId: string, itemId: string, index: number): QueueItem[] | null
  list(subChatId: string): QueueItem[]
  /** One entry per sub-chat that has rows, which is what a feed replays. */
  listAll(): QueueFeedItem[]
  setPaused(subChatId: string, paused: boolean): number
  claim(input: ClaimQueueItemInput): QueueItem | null
  complete(subChatId: string, itemId: string): boolean
  requeue(subChatId: string, itemId: string): boolean
  recoverSending(): number
  subscribe(listener: (item: QueueFeedItem) => void): () => void
}

function toQueueItem(row: QueueItemRow): QueueItem {
  let payload: QueuePayload
  try {
    payload = queuePayloadSchema.parse(JSON.parse(row.payload))
  } catch (error) {
    throw new Error(`queue item ${row.id} carries an unreadable payload: ${String(error)}`)
  }
  return {
    id: row.id,
    subChatId: row.subChatId,
    position: row.position,
    status: row.status as QueueItemStatus,
    payload,
    createdAt: row.createdAt,
    dispatchedAt: row.dispatchedAt,
  }
}

function orderedRowsTx(tx: QueueTx, subChatId: string): QueueItemRow[] {
  return tx
    .select()
    .from(schema.queueItems)
    .where(eq(schema.queueItems.subChatId, subChatId))
    .orderBy(
      asc(schema.queueItems.position),
      asc(schema.queueItems.createdAt),
      asc(schema.queueItems.id),
    )
    .all()
}

function rowByStatusTx(
  tx: QueueTx,
  subChatId: string,
  status: QueueItemStatus,
): QueueItemRow | undefined {
  return tx
    .select()
    .from(schema.queueItems)
    .where(and(eq(schema.queueItems.subChatId, subChatId), eq(schema.queueItems.status, status)))
    .orderBy(asc(schema.queueItems.position), asc(schema.queueItems.createdAt))
    .get()
}

function rewritePositionsTx(tx: QueueTx, orderedIds: string[]): void {
  orderedIds.forEach((id, index) => {
    tx.update(schema.queueItems)
      .set({ position: (index + 1) * POSITION_STEP })
      .where(eq(schema.queueItems.id, id))
      .run()
  })
}

function resumePausedTx(tx: QueueTx, subChatId: string): void {
  tx.update(schema.queueItems)
    .set({ status: "pending" })
    .where(and(eq(schema.queueItems.subChatId, subChatId), eq(schema.queueItems.status, "paused")))
    .run()
}

/**
 * The index a move takes counts the rows the caller can see, which is every
 * row that is not being sent. A row in flight has no place in the card, so it
 * must not shift the index the user picked. The result is a position that puts
 * the row where the visible row at that index sits now, and the row in flight
 * keeps its own place in the total order.
 */
function positionForMoveTx(
  tx: QueueTx,
  subChatId: string,
  row: QueueItemRow,
  index: number,
): number {
  const ordered = orderedRowsTx(tx, subChatId)
  const rest = ordered.filter((candidate) => candidate.id !== row.id)
  const visible = rest.filter((candidate) => candidate.status !== "sending")
  const target = Math.max(0, Math.min(index, visible.length))
  const anchorRow = visible[target]
  const anchor = anchorRow
    ? rest.findIndex((candidate) => candidate.id === anchorRow.id)
    : rest.length
  const before = rest[anchor - 1]
  const after = rest[anchor]
  if (!before && !after) return POSITION_STEP
  if (!before) return after.position - POSITION_STEP
  if (!after) return before.position + POSITION_STEP
  if (after.position - before.position > 1) {
    return Math.floor((before.position + after.position) / 2)
  }
  // No gap left between the two neighbours: renumber this sub-chat's rows,
  // which is the only case a move rewrites more than one row.
  const nextOrder = [...rest.slice(0, anchor), row, ...rest.slice(anchor)].map((r) => r.id)
  rewritePositionsTx(tx, nextOrder)
  return (anchor + 1) * POSITION_STEP
}

export function createQueueStore(db: QueueDb): QueueStore {
  const listeners = new Set<(item: QueueFeedItem) => void>()

  function list(subChatId: string): QueueItem[] {
    return db
      .select()
      .from(schema.queueItems)
      .where(eq(schema.queueItems.subChatId, subChatId))
      .orderBy(
        asc(schema.queueItems.position),
        asc(schema.queueItems.createdAt),
        asc(schema.queueItems.id),
      )
      .all()
      .map(toQueueItem)
  }

  function listAll(): QueueFeedItem[] {
    const grouped = new Map<string, QueueItem[]>()
    for (const row of db.select().from(schema.queueItems).all()) {
      const item = toQueueItem(row)
      const items = grouped.get(item.subChatId)
      if (items) {
        items.push(item)
      } else {
        grouped.set(item.subChatId, [item])
      }
    }
    return [...grouped.entries()].map(([subChatId, items]) => ({
      subChatId,
      items: items.sort(
        (a, b) =>
          a.position - b.position ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          (a.id < b.id ? -1 : 1),
      ),
    }))
  }

  function emit(subChatId: string): void {
    const item: QueueFeedItem = { subChatId, items: list(subChatId) }
    for (const listener of listeners) {
      try {
        listener(item)
      } catch (error) {
        console.error(`[queue] listener failed for sub-chat ${subChatId.slice(-8)}:`, error)
      }
    }
  }

  function add(input: AddQueueItemInput): QueueItem {
    const payload = queuePayloadSchema.parse(input.payload)
    const created = db.transaction((tx): QueueItem => {
      const lastPosition = tx
        .select({ position: max(schema.queueItems.position) })
        .from(schema.queueItems)
        .where(eq(schema.queueItems.subChatId, input.subChatId))
        .get()?.position
      const createdAt = new Date()
      const inserted = tx
        .insert(schema.queueItems)
        .values({
          id: createId(),
          subChatId: input.subChatId,
          position: (lastPosition ?? 0) + POSITION_STEP,
          status: "pending",
          payload: JSON.stringify(payload),
          createdAt,
        })
        .returning()
        .get()
      // An explicit send is what ends a pause, and queueing a message is one.
      resumePausedTx(tx, input.subChatId)
      return toQueueItem(inserted)
    })
    emit(input.subChatId)
    return created
  }

  function remove(subChatId: string, itemId: string): boolean {
    const removed = db
      .delete(schema.queueItems)
      .where(and(eq(schema.queueItems.id, itemId), eq(schema.queueItems.subChatId, subChatId)))
      .returning()
      .all()
    if (removed.length === 0) return false
    console.log(`[queue] complete ${itemId.slice(-8)} sub=${subChatId.slice(-8)}`)
    emit(subChatId)
    return true
  }

  function clear(subChatId: string): number {
    const removed = db
      .delete(schema.queueItems)
      .where(eq(schema.queueItems.subChatId, subChatId))
      .returning()
      .all()
    if (removed.length > 0) emit(subChatId)
    return removed.length
  }

  function move(subChatId: string, itemId: string, index: number): QueueItem[] | null {
    let moved = false
    db.transaction((tx) => {
      const row = tx
        .select()
        .from(schema.queueItems)
        .where(and(eq(schema.queueItems.id, itemId), eq(schema.queueItems.subChatId, subChatId)))
        .get()
      if (!row) return
      const position = positionForMoveTx(tx, subChatId, row, index)
      tx.update(schema.queueItems).set({ position }).where(eq(schema.queueItems.id, itemId)).run()
      moved = true
    })
    if (!moved) return null
    emit(subChatId)
    return list(subChatId)
  }

  function setPaused(subChatId: string, paused: boolean): number {
    const changed = db
      .update(schema.queueItems)
      .set({ status: paused ? "paused" : "pending" })
      .where(
        and(
          eq(schema.queueItems.subChatId, subChatId),
          eq(schema.queueItems.status, paused ? "pending" : "paused"),
        ),
      )
      .returning()
      .all()
    if (changed.length > 0) {
      console.log(
        `[queue] ${paused ? "paused" : "resumed"} sub=${subChatId.slice(-8)} rows=${changed.length}`,
      )
      emit(subChatId)
    }
    return changed.length
  }

  function claim(input: ClaimQueueItemInput): QueueItem | null {
    let claimed: QueueItem | null = null
    db.transaction((tx) => {
      const row = input.itemId
        ? tx
            .select()
            .from(schema.queueItems)
            .where(
              and(
                eq(schema.queueItems.id, input.itemId),
                eq(schema.queueItems.subChatId, input.subChatId),
              ),
            )
            .get()
        : rowByStatusTx(tx, input.subChatId, "pending")
      if (!row || row.status === "sending") return

      if (!input.itemId) {
        // A dispatch waits for the sub-chat to be idle. The run table is the
        // truth for the engines that write one; a window that asked may only
        // reach here while its own status says ready.
        const activeRun = tx
          .select()
          .from(schema.runs)
          .where(
            and(
              eq(schema.runs.subChatId, input.subChatId),
              inArray(schema.runs.status, [...ACTIVE_RUN_STATUSES]),
            ),
          )
          .get()
        if (activeRun) return
        if (rowByStatusTx(tx, input.subChatId, "sending")) return
        // One paused row means the user stopped; nothing dispatches until an
        // explicit send resumes the queue.
        if (rowByStatusTx(tx, input.subChatId, "paused")) return
      }

      const allowedFrom: QueueItemStatus[] = input.itemId ? ["pending", "paused"] : ["pending"]
      const updated = tx
        .update(schema.queueItems)
        .set({ status: "sending", dispatchedAt: new Date() })
        .where(
          and(eq(schema.queueItems.id, row.id), inArray(schema.queueItems.status, allowedFrom)),
        )
        .returning()
        .get()
      if (updated) claimed = toQueueItem(updated)
    })
    if (claimed) {
      // One line per dispatch so a report of a missing or duplicated queued
      // message can be answered from the log folder. Ids only, never payload.
      console.log(
        `[queue] claim ${claimed.id.slice(-8)} sub=${input.subChatId.slice(-8)} via=${
          input.itemId ? "send-now" : "dispatch"
        }`,
      )
      emit(input.subChatId)
    }
    return claimed
  }

  function complete(subChatId: string, itemId: string): boolean {
    const removed = db
      .delete(schema.queueItems)
      .where(
        and(
          eq(schema.queueItems.id, itemId),
          eq(schema.queueItems.subChatId, subChatId),
          eq(schema.queueItems.status, "sending"),
        ),
      )
      .returning()
      .all()
    if (removed.length === 0) return false
    emit(subChatId)
    return true
  }

  function requeue(subChatId: string, itemId: string): boolean {
    const updated = db
      .update(schema.queueItems)
      .set({ status: "pending", dispatchedAt: null })
      .where(
        and(
          eq(schema.queueItems.id, itemId),
          eq(schema.queueItems.subChatId, subChatId),
          eq(schema.queueItems.status, "sending"),
        ),
      )
      .returning()
      .all()
    if (updated.length === 0) return false
    console.log(`[queue] requeue ${itemId.slice(-8)} sub=${subChatId.slice(-8)}`)
    emit(subChatId)
    return true
  }

  function recoverSending(): number {
    const rows = db
      .select()
      .from(schema.queueItems)
      .where(eq(schema.queueItems.status, "sending"))
      .all()
    if (rows.length === 0) return 0
    db.update(schema.queueItems)
      .set({ status: "pending", dispatchedAt: null })
      .where(eq(schema.queueItems.status, "sending"))
      .run()
    for (const subChatId of new Set(rows.map((row) => row.subChatId))) {
      emit(subChatId)
    }
    return rows.length
  }

  return {
    add,
    remove,
    clear,
    move,
    list,
    listAll,
    setPaused,
    claim,
    complete,
    requeue,
    recoverSending,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
