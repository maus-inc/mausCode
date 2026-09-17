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
import { and, asc, eq, inArray, isNotNull, isNull, lt, max } from "drizzle-orm"
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
  /**
   * The window session asking for the row. It owns the claim until it hands
   * the payload over or gives it back, and another session may take over a
   * claim that was never handed over.
   */
  owner: string
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
  /**
   * Record that the claiming window passed this payload to the engine. Only
   * the owner can set it, and only once: `false` means the claim moved on and
   * the caller must not send.
   */
  markHanded(subChatId: string, itemId: string, owner: string): boolean
  /**
   * Hold a claimed row whose send outcome is unknown: the payload was handed
   * over, and the turn never reported itself. A parked row is visible and is
   * never put back into the automatic path by a resume, because sending it
   * again is what could duplicate the message. Owner-scoped: parking another
   * window's live send would take the row away from the one window that can
   * still record what happened to it.
   */
  park(subChatId: string, itemId: string, owner: string): boolean
  /** Release what a window claimed, for a window that closed. */
  releaseOwner(owner: string): number
  /**
   * Retire a row whose message went out, so it leaves the queue. Owner-scoped
   * for the same reason as the hand-off: the window that sent it is the only
   * one that knows it did. A row that was never handed over is refused, so a
   * completion arriving early cannot delete a message the engine never saw.
   */
  complete(subChatId: string, itemId: string, owner: string): boolean
  /**
   * Put a claim this window decided not to use back in the queue. Like every
   * other write after the claim, only the owner may do it, and only for a row
   * that was never handed over: a handed row's message may already be in the
   * engine, and making it `pending` again is what would send it twice.
   */
  requeue(subChatId: string, itemId: string, owner: string): boolean
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

/**
 * How long an un-handed claim is trusted. A window holds a claim only while it
 * assembles the send, and the longest wait on that path is the Send now stop
 * wait (`STREAMING_READY_TIMEOUT_MS`), so a claim this old belongs to a session
 * that is gone: a crashed renderer, or a window that never came back from a
 * reload. Waiting it out is the same as the claim never having been made,
 * because `handedAt` is still null and the payload therefore never left.
 */
export const CLAIM_LEASE_MS = 45_000

/**
 * Put back a claim whose lease ran out. Safe by definition: `handedAt` is
 * written immediately before the payload goes to the engine, so a null value
 * there means nothing was sent under this claim.
 */
function releaseStaleClaimsTx(tx: QueueTx, subChatId: string, now: number): number {
  const released = tx
    .update(schema.queueItems)
    .set({ status: "pending", dispatchedAt: null, claimedBy: null })
    .where(
      and(
        eq(schema.queueItems.subChatId, subChatId),
        eq(schema.queueItems.status, "sending"),
        isNull(schema.queueItems.handedAt),
        lt(schema.queueItems.dispatchedAt, new Date(now - CLAIM_LEASE_MS)),
      ),
    )
    .returning()
    .all()
  return released.length
}

/**
 * A pause the user asked for: nothing new dispatches until an explicit send.
 * Parked rows are `paused` too, but they are a message whose fate is unknown,
 * so they do not stop the queue behind them.
 */
function userPausedTx(tx: QueueTx, subChatId: string): QueueItemRow | undefined {
  return tx
    .select()
    .from(schema.queueItems)
    .where(
      and(
        eq(schema.queueItems.subChatId, subChatId),
        eq(schema.queueItems.status, "paused"),
        isNull(schema.queueItems.handedAt),
      ),
    )
    .orderBy(asc(schema.queueItems.position), asc(schema.queueItems.createdAt))
    .get()
}

/** Park one row: out of the automatic path, still visible, never auto-resumed. */
function parkRowTx(tx: QueueTx, itemId: string): boolean {
  const parked = tx
    .update(schema.queueItems)
    .set({ status: "paused", claimedBy: null })
    .where(and(eq(schema.queueItems.id, itemId), eq(schema.queueItems.status, "sending")))
    .returning()
    .all()
  return parked.length > 0
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

/**
 * The row a window itself holds, still `sending`, with nothing handed over yet.
 * `markHanded` takes it from one side and `requeue` gives it back from the
 * other, so both write through this one guard: neither can touch a row another
 * window holds, or one whose message may already be out.
 */
function ownClaimWhere(itemId: string, subChatId: string, owner: string) {
  return and(
    eq(schema.queueItems.id, itemId),
    eq(schema.queueItems.subChatId, subChatId),
    eq(schema.queueItems.status, "sending"),
    eq(schema.queueItems.claimedBy, owner),
    isNull(schema.queueItems.handedAt),
  )
}

/**
 * End a user pause for this sub-chat. Only the rows the stop held back come
 * back: a parked row already left for the engine, so it keeps its place where
 * the user can see it instead of returning to the automatic path.
 */
function resumePausedTx(tx: QueueTx, subChatId: string): void {
  tx.update(schema.queueItems)
    .set({ status: "pending" })
    .where(
      and(
        eq(schema.queueItems.subChatId, subChatId),
        eq(schema.queueItems.status, "paused"),
        isNull(schema.queueItems.handedAt),
      ),
    )
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
    return [...grouped.entries()].map(([subChatId, items]) => {
      // Same total order `list` uses. The array is local to this call, so it
      // is sorted in place rather than through a copy.
      items.sort(
        (a, b) =>
          a.position - b.position ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          (a.id < b.id ? -1 : 1),
      )
      return { subChatId, items }
    })
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

  function markHanded(subChatId: string, itemId: string, owner: string): boolean {
    const updated = db
      .update(schema.queueItems)
      .set({ handedAt: new Date() })
      .where(ownClaimWhere(itemId, subChatId, owner))
      .returning()
      .all()
    if (updated.length === 0) return false
    console.log(`[queue] handed ${itemId.slice(-8)} sub=${subChatId.slice(-8)}`)
    return true
  }

  function remove(subChatId: string, itemId: string): boolean {
    const removed = db
      .delete(schema.queueItems)
      .where(and(eq(schema.queueItems.id, itemId), eq(schema.queueItems.subChatId, subChatId)))
      .returning()
      .all()
    if (removed.length === 0) return false
    console.log(`[queue] remove ${itemId.slice(-8)} sub=${subChatId.slice(-8)}`)
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
          // Resuming is about the rows the user's stop held back. A parked row
          // already left for the engine, so it stays where the user can see it
          // instead of returning to the automatic path.
          isNull(schema.queueItems.handedAt),
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
    // The claimed row travels out through the transaction's return value, the
    // shape `add` already uses, so nothing is read from a variable a callback
    // assigned.
    const claimed = db.transaction((tx): QueueItem | null => {
      const explicit = input.itemId
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
        : undefined
      if (input.itemId && !explicit) return null

      // An abandoned claim is put back first. That is how a queue recovers
      // from a renderer that crashed or reloaded while the app kept running,
      // and it cannot send twice: the claim was never handed over, and the old
      // owner's `markHanded` fails once the row is claimed again, so it must
      // not send.
      releaseStaleClaimsTx(tx, input.subChatId, Date.now())

      const inFlight = rowByStatusTx(tx, input.subChatId, "sending")
      if (inFlight && inFlight.id !== explicit?.id) {
        // A handed claim of this same window belongs to a session that is gone
        // (a reload between the hand-off and the bookkeeping): a live window
        // does not claim while its own send is in flight, because the renderer
        // holds that slot. Its outcome is unknown, so the row is parked for the
        // user and the queue moves on. Everything else — another window's live
        // send, or this window's claim that has not been handed over yet — is
        // refused, and an abandoned claim is released by its lease above.
        if (inFlight.claimedBy !== input.owner || inFlight.handedAt === null) return null
        parkRowTx(tx, inFlight.id)
      }

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
        if (activeRun) return null
        // One user pause means the user stopped; nothing dispatches until an
        // explicit send resumes the queue. Parked rows are not a stop.
        if (userPausedTx(tx, input.subChatId)) return null
      }

      // Dispatch takes the head of the queue; Send now takes exactly the row it
      // was asked for. The where clause is the guard that decides a race
      // between two windows, so nothing is assumed from the read above.
      const row = explicit ?? rowByStatusTx(tx, input.subChatId, "pending")
      if (!row) return null

      const allowedFrom: QueueItemStatus[] = input.itemId ? ["pending", "paused"] : ["pending"]
      const updated = tx
        .update(schema.queueItems)
        .set({
          status: "sending",
          dispatchedAt: new Date(),
          claimedBy: input.owner,
          handedAt: null,
        })
        .where(
          and(eq(schema.queueItems.id, row.id), inArray(schema.queueItems.status, allowedFrom)),
        )
        .returning()
        .get()
      return updated ? toQueueItem(updated) : null
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

  function park(subChatId: string, itemId: string, owner: string): boolean {
    const removed = db
      .update(schema.queueItems)
      .set({ status: "paused", claimedBy: null })
      .where(
        and(
          eq(schema.queueItems.id, itemId),
          eq(schema.queueItems.subChatId, subChatId),
          eq(schema.queueItems.status, "sending"),
          eq(schema.queueItems.claimedBy, owner),
          // Only a row that was handed over: a parked row never returns to the
          // automatic path, so parking a claim the engine never saw would hide
          // a message the user is still waiting for. That row is the caller's
          // to requeue, not to park.
          isNotNull(schema.queueItems.handedAt),
        ),
      )
      .returning()
      .all()
    if (removed.length === 0) return false
    console.warn(
      `[queue] parked ${itemId.slice(-8)} sub=${subChatId.slice(-8)}: handed over without a turn start, not resent automatically`,
    )
    emit(subChatId)
    return true
  }

  /**
   * Hand back what a closed window held. A claim it never handed over goes to
   * `pending`, because nothing left the machine; a claim it did hand over is
   * parked, because the engine may have taken it and the row is no longer
   * something to send again.
   */
  function releaseOwner(owner: string): number {
    const released = db
      .update(schema.queueItems)
      .set({ status: "pending", dispatchedAt: null, claimedBy: null })
      .where(
        and(
          eq(schema.queueItems.claimedBy, owner),
          eq(schema.queueItems.status, "sending"),
          isNull(schema.queueItems.handedAt),
        ),
      )
      .returning()
      .all()
    const parked = db
      .update(schema.queueItems)
      .set({ status: "paused", claimedBy: null })
      .where(
        and(
          eq(schema.queueItems.claimedBy, owner),
          eq(schema.queueItems.status, "sending"),
          isNotNull(schema.queueItems.handedAt),
        ),
      )
      .returning()
      .all()
    if (released.length === 0 && parked.length === 0) return 0
    console.warn(
      `[queue] window ${owner} closed holding ${released.length} claim(s) and ${parked.length} handed send(s)`,
    )
    const subChatIds = new Set([...released, ...parked].map((row) => row.subChatId))
    for (const subChatId of subChatIds) {
      emit(subChatId)
    }
    return released.length + parked.length
  }

  function complete(subChatId: string, itemId: string, owner: string): boolean {
    const removed = db
      .delete(schema.queueItems)
      .where(
        and(
          eq(schema.queueItems.id, itemId),
          eq(schema.queueItems.subChatId, subChatId),
          eq(schema.queueItems.status, "sending"),
          eq(schema.queueItems.claimedBy, owner),
          // Only after the hand-off, which is what `markHanded` records:
          // deleting a claim the engine never saw would lose the message
          // instead of sending it. A row that was never handed over is still
          // the queue's, and a completion arriving early must not remove it.
          isNotNull(schema.queueItems.handedAt),
        ),
      )
      .returning()
      .all()
    if (removed.length === 0) return false
    emit(subChatId)
    return true
  }

  function requeue(subChatId: string, itemId: string, owner: string): boolean {
    const updated = db
      .update(schema.queueItems)
      .set({ status: "pending", dispatchedAt: null, claimedBy: null, handedAt: null })
      .where(ownClaimWhere(itemId, subChatId, owner))
      .returning()
      .all()
    if (updated.length === 0) return false
    console.log(`[queue] requeue ${itemId.slice(-8)} sub=${subChatId.slice(-8)}`)
    emit(subChatId)
    return true
  }

  /**
   * Return every row a previous run of the app left `sending`. A claim whose
   * payload was never handed over goes back to `pending`: nothing was sent, so
   * sending it is not a repeat. A claim that was handed over is ambiguous —
   * the message may have reached the engine before the app died — so it is
   * held as `paused` instead of being sent again, which puts the decision in
   * front of the user and never in front of the engine.
   */
  function recoverSending(): number {
    const rows = db
      .select()
      .from(schema.queueItems)
      .where(eq(schema.queueItems.status, "sending"))
      .all()
    if (rows.length === 0) return 0
    const neverHanded = rows.filter((row) => row.handedAt === null)
    const handed = rows.filter((row) => row.handedAt !== null)
    if (neverHanded.length > 0) {
      db.update(schema.queueItems)
        .set({ status: "pending", dispatchedAt: null, claimedBy: null })
        .where(and(eq(schema.queueItems.status, "sending"), isNull(schema.queueItems.handedAt)))
        .run()
    }
    if (handed.length > 0) {
      db.update(schema.queueItems)
        .set({ status: "paused", claimedBy: null })
        .where(and(eq(schema.queueItems.status, "sending"), isNotNull(schema.queueItems.handedAt)))
        .run()
      console.warn(
        `[queue] recovery held ${handed.length} handed-over row(s) as paused; the message may already have been sent`,
      )
    }
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
    markHanded,
    park,
    releaseOwner,
    complete,
    requeue,
    recoverSending,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
