/**
 * Run state machine, owned by the main process (roadmap step 07).
 *
 * One `runs` row per agent turn, plus an append-only `run_events` log with a
 * per-run sequence that makes cursor replay possible. Every status write
 * happens in the same transaction as its event append. Design contract:
 * `.dump/app/plans/2026-09-13-run-state.md`.
 *
 * Dependencies are injected: tests pass a database opened by
 * `src/main/lib/db/test-sqlite.ts`. The main-process singleton lives in
 * `./index.ts` so this module stays free of Electron imports.
 */
import { and, desc, eq, gt, inArray } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import {
  ACTIVE_RUN_STATUSES,
  isActiveRunStatus,
  type RunEngine,
  type RunStatus,
} from "../../../shared/run-state"
import * as schema from "../db/schema"
import { createId } from "../db/utils"

type RunStoreDb = BetterSQLite3Database<typeof schema>
type RunStoreTx = RunStoreDb["transaction"] extends (fn: (tx: infer T) => unknown) => unknown
  ? T
  : never
type Run = schema.Run
type RunEvent = schema.RunEvent

export const RUN_ERROR_TEXT_CAP = 500
export const RUN_TOOL_NAME_CAP = 200
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

export interface StartRunInput {
  subChatId: string
  engine: RunEngine
  mode?: string
  model?: string | null
  provider?: string | null
}

export interface RunFeedItem {
  run: Run
  event: RunEvent | null
}

export interface RunHandle {
  runId: string
  subChatId: string
  noteStarted(): void
  noteApprovalRequested(toolName?: string): void
  noteApprovalResolved(approved: boolean): void
  noteError(errorText: string): void
  noteFinished(): void
  settle(hint?: RunStatus, stopReason?: string): void
}

/**
 * The chunk fields the observer reads. Both chat engines emit this shape
 * (`UIMessageChunk` in `src/main/lib/claude/types.ts` narrows to it), so the
 * chunk-to-transition mapping exists once instead of once per router.
 */
export interface RunObservableChunk {
  type: string
  errorText?: string
  questions?: Array<{ header?: string }>
}

export function observeRunChunk(handle: RunHandle, chunk: RunObservableChunk): void {
  handle.noteStarted()
  switch (chunk.type) {
    case "ask-user-question":
      handle.noteApprovalRequested(chunk.questions?.[0]?.header)
      break
    case "ask-user-question-timeout":
      handle.noteApprovalResolved(false)
      break
    case "error":
    case "auth-error":
      handle.noteError(chunk.errorText ?? "unknown error")
      break
    case "finish":
      handle.noteFinished()
      break
    default:
      break
  }
}

interface Listener {
  onItem: (item: RunFeedItem) => void
  subChatId?: string
}

function capText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export interface RunWithEvents {
  run: Run
  events: RunEvent[]
}

export interface RunStore {
  startRun(input: StartRunInput): RunHandle
  getRun(runId: string, afterSeq?: number): RunWithEvents | null
  listRuns(options?: { subChatId?: string; activeOnly?: boolean; limit?: number }): Run[]
  activeRunForSubChat(subChatId: string): Run | null
  activeRuns(): Run[]
  activeRunChatIds(chatIds: string[]): Set<string>
  latestRunBySubChat(subChatIds: string[]): Map<string, Run>
  resolveApprovalForSubChat(subChatId: string, approved: boolean): void
  cancelActiveForSubChat(subChatId: string, stopReason?: string): boolean
  recoverInterrupted(): Run[]
  subscribe(onItem: (item: RunFeedItem) => void, filter?: { subChatId?: string }): () => void
}

export function createRunStore(db: RunStoreDb): RunStore {
  const listeners = new Set<Listener>()

  function emit(run: Run, event: RunEvent | null): void {
    const item: RunFeedItem = { run: { ...run }, event: event ? { ...event } : null }
    for (const listener of listeners) {
      if (listener.subChatId && listener.subChatId !== run.subChatId) continue
      try {
        listener.onItem(item)
      } catch (error) {
        console.error(`[runs] listener failed for run ${run.id}:`, error)
      }
    }
  }

  function appendEventTx(
    tx: RunStoreTx,
    run: Run,
    kind: string,
    payload: Record<string, unknown>,
    at = new Date(),
  ): RunEvent {
    const seq = run.lastSeq + 1
    const event: RunEvent = {
      id: createId(),
      runId: run.id,
      seq,
      kind,
      payload: JSON.stringify(payload),
      at,
    }
    tx.insert(schema.runEvents).values(event).run()
    run.lastSeq = seq
    return event
  }

  function settleRunTx(
    tx: RunStoreTx,
    run: Run,
    status: RunStatus,
    stopReason: string,
    extraPayload: Record<string, unknown> = {},
  ): RunEvent {
    const endedAt = new Date()
    const event = appendEventTx(
      tx,
      run,
      "settled",
      { status, stopReason, ...extraPayload },
      endedAt,
    )
    tx.update(schema.runs)
      .set({
        status,
        endedAt,
        stopReason,
        approvalPending: false,
        lastSeq: run.lastSeq,
      })
      .where(eq(schema.runs.id, run.id))
      .run()
    run.status = status
    run.endedAt = endedAt
    run.stopReason = stopReason
    run.approvalPending = false
    return event
  }

  function applyApprovalResolvedTx(tx: RunStoreTx, run: Run, approved: boolean): RunEvent {
    const event = appendEventTx(tx, run, "approval_resolved", { approved })
    tx.update(schema.runs)
      .set({ status: "running", approvalPending: false, lastSeq: run.lastSeq })
      .where(eq(schema.runs.id, run.id))
      .run()
    run.status = "running"
    run.approvalPending = false
    return event
  }

  function settleOutstandingForSubChatTx(
    tx: RunStoreTx,
    subChatId: string,
    stopReason: string,
  ): Run[] {
    const outstanding = tx
      .select()
      .from(schema.runs)
      .where(
        and(
          eq(schema.runs.subChatId, subChatId),
          inArray(schema.runs.status, [...ACTIVE_RUN_STATUSES]),
        ),
      )
      .all()
    for (const run of outstanding) {
      settleRunTx(tx, run, "cancelled", stopReason)
    }
    return outstanding
  }

  function startRun(input: StartRunInput): RunHandle {
    const provider =
      input.provider ??
      db
        .select({ provider: schema.subChats.provider })
        .from(schema.subChats)
        .where(eq(schema.subChats.id, input.subChatId))
        .get()?.provider ??
      null

    const settled: Run[] = []
    const now = new Date()
    let run: Run = {
      id: "",
      subChatId: input.subChatId,
      status: "running",
      startedAt: now,
      endedAt: null,
      stopReason: null,
      approvalPending: false,
      engine: input.engine,
      provider,
      model: input.model ?? null,
      lastSeq: 0,
    }

    db.transaction((tx) => {
      settled.push(...settleOutstandingForSubChatTx(tx, input.subChatId, "superseded"))
      const inserted = tx
        .insert(schema.runs)
        .values({
          subChatId: input.subChatId,
          status: "running",
          startedAt: now,
          engine: input.engine,
          provider,
          model: input.model ?? null,
        })
        .returning()
        .get()
      run = inserted
      appendEventTx(tx, run, "created", {
        engine: input.engine,
        ...(input.mode !== undefined && { mode: input.mode }),
        ...(input.model != null && { model: input.model }),
        ...(provider != null && { provider }),
      })
      tx.update(schema.runs).set({ lastSeq: run.lastSeq }).where(eq(schema.runs.id, run.id)).run()
    })

    console.log(
      `[runs] start ${run.id.slice(-8)} sub=${input.subChatId.slice(-8)} engine=${input.engine}`,
    )
    for (const old of settled) {
      emit(old, null)
    }
    emit(run, null)

    return createHandle(run, input.subChatId)
  }

  function createHandle(run: Run, subChatId: string): RunHandle {
    let startedNoted = false
    let finishedNoted = false
    let pendingError: string | null = null
    let settledDone = false

    function activeRun(): Run | null {
      if (settledDone || !isActiveRunStatus(run.status)) return null
      const fresh = db.select().from(schema.runs).where(eq(schema.runs.id, run.id)).get()
      if (!fresh || !isActiveRunStatus(fresh.status)) return null
      run = fresh
      return run
    }

    function guard(fn: () => void, label: string): void {
      try {
        fn()
      } catch (error) {
        console.error(`[runs] ${label} failed for run ${run.id}:`, error)
      }
    }

    return {
      runId: run.id,
      subChatId,

      noteStarted(): void {
        if (startedNoted) return
        guard(() => {
          const current = activeRun()
          if (!current) return
          startedNoted = true
          let event: RunEvent | null = null
          db.transaction((tx) => {
            event = appendEventTx(tx, current, "started", {})
            tx.update(schema.runs)
              .set({ lastSeq: current.lastSeq })
              .where(eq(schema.runs.id, current.id))
              .run()
          })
          if (event) emit(current, event)
        }, "noteStarted")
      },

      noteApprovalRequested(toolName?: string): void {
        guard(() => {
          const current = activeRun()
          if (!current) return
          let event: RunEvent | null = null
          db.transaction((tx) => {
            event = appendEventTx(
              tx,
              current,
              "approval_requested",
              toolName ? { tool: capText(toolName, RUN_TOOL_NAME_CAP) } : {},
            )
            tx.update(schema.runs)
              .set({ status: "waiting_approval", approvalPending: true, lastSeq: current.lastSeq })
              .where(eq(schema.runs.id, current.id))
              .run()
            current.status = "waiting_approval"
            current.approvalPending = true
          })
          if (event) emit(current, event)
        }, "noteApprovalRequested")
      },

      noteApprovalResolved(approved: boolean): void {
        guard(() => {
          const current = activeRun()
          if (current?.status !== "waiting_approval") return
          let event: RunEvent | null = null
          db.transaction((tx) => {
            event = applyApprovalResolvedTx(tx, current, approved)
          })
          if (event) emit(current, event)
        }, "noteApprovalResolved")
      },

      noteError(errorText: string): void {
        if (!pendingError) pendingError = capText(errorText, RUN_ERROR_TEXT_CAP)
      },

      noteFinished(): void {
        finishedNoted = true
      },

      settle(hint?: RunStatus, stopReason?: string): void {
        if (settledDone) return
        guard(() => {
          settledDone = true
          const current = db.select().from(schema.runs).where(eq(schema.runs.id, run.id)).get()
          if (!current || !isActiveRunStatus(current.status)) return

          let status: RunStatus
          let reason: string
          if (hint === "cancelled") {
            status = "cancelled"
            reason = stopReason ?? "aborted"
          } else if (hint === "error" || pendingError) {
            status = "error"
            reason = stopReason ?? "turn_failed"
          } else if (hint === "completed" || finishedNoted) {
            status = "completed"
            reason = stopReason ?? "finished"
          } else {
            // No finish, no error, no cancel hint: the exit is unexplained,
            // and interrupted is the truthful state.
            status = "interrupted"
            reason = stopReason ?? "unknown_exit"
          }

          run = current
          let event: RunEvent | null = null
          db.transaction((tx) => {
            event = settleRunTx(
              tx,
              current,
              status,
              reason,
              pendingError ? { errorText: pendingError } : {},
            )
          })
          console.log(`[runs] settle ${run.id.slice(-8)} status=${status} reason=${reason}`)
          if (event) emit(current, event)
        }, "settle")
      },
    }
  }

  function resolveApprovalForSubChat(subChatId: string, approved: boolean): void {
    const run = db
      .select()
      .from(schema.runs)
      .where(and(eq(schema.runs.subChatId, subChatId), eq(schema.runs.status, "waiting_approval")))
      .orderBy(desc(schema.runs.startedAt))
      .get()
    if (!run) return
    let event: RunEvent | null = null
    db.transaction((tx) => {
      event = applyApprovalResolvedTx(tx, run, approved)
    })
    if (event) emit(run, event)
  }

  function cancelActiveForSubChat(subChatId: string, stopReason = "user_cancel"): boolean {
    const run = db
      .select()
      .from(schema.runs)
      .where(
        and(
          eq(schema.runs.subChatId, subChatId),
          inArray(schema.runs.status, [...ACTIVE_RUN_STATUSES]),
        ),
      )
      .orderBy(desc(schema.runs.startedAt))
      .get()
    if (!run) return false
    let event: RunEvent | null = null
    db.transaction((tx) => {
      event = settleRunTx(tx, run, "cancelled", stopReason)
    })
    if (event) emit(run, event)
    return true
  }

  function recoverInterrupted(): Run[] {
    const active = db
      .select()
      .from(schema.runs)
      .where(inArray(schema.runs.status, [...ACTIVE_RUN_STATUSES]))
      .all()
    const recovered: Run[] = []
    for (const run of active) {
      const lastEvent = db
        .select()
        .from(schema.runEvents)
        .where(eq(schema.runEvents.runId, run.id))
        .orderBy(desc(schema.runEvents.seq))
        .get()
      let settled: RunEvent | null = null
      db.transaction((tx) => {
        settled = settleRunTx(tx, run, "interrupted", "recovered_at_startup", {
          ...(lastEvent && {
            evidence: { kind: lastEvent.kind, seq: lastEvent.seq, at: lastEvent.at },
          }),
        })
      })
      recovered.push(run)
      if (settled) emit(run, settled)
      console.log(
        `[runs] recovered ${run.id.slice(-8)} sub=${run.subChatId.slice(-8)} lastEvent=${lastEvent?.kind ?? "none"}`,
      )
    }
    return recovered
  }

  function getRun(runId: string, afterSeq = 0): RunWithEvents | null {
    const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()
    if (!run) return null
    const events = db
      .select()
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.runId, runId), gt(schema.runEvents.seq, afterSeq)))
      .orderBy(schema.runEvents.seq)
      .all()
    return { run, events }
  }

  function listRuns(options?: { subChatId?: string; activeOnly?: boolean; limit?: number }): Run[] {
    const limit = Math.min(Math.max(options?.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
    const conditions = []
    if (options?.subChatId) {
      conditions.push(eq(schema.runs.subChatId, options.subChatId))
    }
    if (options?.activeOnly) {
      conditions.push(inArray(schema.runs.status, [...ACTIVE_RUN_STATUSES]))
    }
    const query = db
      .select()
      .from(schema.runs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.runs.startedAt), desc(schema.runs.id))
      .limit(limit)
    return query.all()
  }

  function activeRunForSubChat(subChatId: string): Run | null {
    return (
      db
        .select()
        .from(schema.runs)
        .where(
          and(
            eq(schema.runs.subChatId, subChatId),
            inArray(schema.runs.status, [...ACTIVE_RUN_STATUSES]),
          ),
        )
        .orderBy(desc(schema.runs.startedAt))
        .get() ?? null
    )
  }

  function activeRuns(): Run[] {
    return db
      .select()
      .from(schema.runs)
      .where(inArray(schema.runs.status, [...ACTIVE_RUN_STATUSES]))
      .orderBy(desc(schema.runs.startedAt))
      .all()
  }

  function activeRunChatIds(chatIds: string[]): Set<string> {
    if (chatIds.length === 0) return new Set()
    const rows = db
      .select({ chatId: schema.subChats.chatId })
      .from(schema.runs)
      .innerJoin(schema.subChats, eq(schema.runs.subChatId, schema.subChats.id))
      .where(
        and(
          inArray(schema.subChats.chatId, chatIds),
          inArray(schema.runs.status, [...ACTIVE_RUN_STATUSES]),
        ),
      )
      .all()
    return new Set(rows.map((row) => row.chatId))
  }

  function latestRunBySubChat(subChatIds: string[]): Map<string, Run> {
    const map = new Map<string, Run>()
    if (subChatIds.length === 0) return map
    const rows = db
      .select()
      .from(schema.runs)
      .where(inArray(schema.runs.subChatId, subChatIds))
      .orderBy(desc(schema.runs.startedAt), desc(schema.runs.id))
      .all()
    for (const row of rows) {
      if (!map.has(row.subChatId)) map.set(row.subChatId, row)
    }
    return map
  }

  function subscribe(
    onItem: (item: RunFeedItem) => void,
    filter?: { subChatId?: string },
  ): () => void {
    const listener: Listener = { onItem, subChatId: filter?.subChatId }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    startRun,
    getRun,
    listRuns,
    activeRunForSubChat,
    activeRuns,
    activeRunChatIds,
    latestRunBySubChat,
    resolveApprovalForSubChat,
    cancelActiveForSubChat,
    recoverInterrupted,
    subscribe,
  }
}
