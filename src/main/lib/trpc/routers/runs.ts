/**
 * Runs router (roadmap step 07): read and subscribe to the main-owned run
 * record. `get` replays events past a cursor, `list` returns run rows, and
 * `subscribe` replays a snapshot on open, then streams live transitions.
 * Design contract: `.dump/app/plans/2026-09-13-run-state.md`.
 */
import { type Observer, observable } from "@trpc/server/observable"
import { z } from "zod"
import type { Run, RunEvent } from "../../db/schema"
import { getRunStore, type RunStore } from "../../runs"
import { publicProcedure, router } from "../index"

export interface RunsFeedItem {
  run: Run
  event: RunEvent | null
}

/**
 * Emits the replay snapshot and returns the highest replayed seq per run, so
 * the live stream can drop items the replay already covered. With
 * `subChatId`, `afterSeq` and the `cursorRunId` that produced the cursor, it
 * replays that run's events past the cursor; a cursor that belongs to an
 * older run falls back to a snapshot of the newest run, because seq is
 * per-run and an old cursor would swallow the new run's early events. With
 * `subChatId` alone it emits a snapshot item for the newest run; with
 * neither it emits a snapshot item per active run.
 */
function replaySnapshot(
  store: RunStore,
  emit: Observer<RunsFeedItem, unknown>,
  subChatId?: string,
  afterSeq?: number,
  cursorRunId?: string,
): Map<string, number> {
  const replayedSeqByRun = new Map<string, number>()
  if (!subChatId) {
    for (const run of store.activeRuns()) {
      emit.next({ run, event: null })
      replayedSeqByRun.set(run.id, run.lastSeq)
    }
    return replayedSeqByRun
  }

  const latest = store.listRuns({ subChatId, limit: 1 })[0]
  if (!latest) return replayedSeqByRun
  if (typeof afterSeq !== "number" || cursorRunId !== latest.id) {
    emit.next({ run: latest, event: null })
    replayedSeqByRun.set(latest.id, latest.lastSeq)
    return replayedSeqByRun
  }

  const withEvents = store.getRun(latest.id, afterSeq)
  if (!withEvents) return replayedSeqByRun
  for (const event of withEvents.events) {
    emit.next({ run: withEvents.run, event })
    replayedSeqByRun.set(latest.id, event.seq)
  }
  return replayedSeqByRun
}

export const runsRouter = router({
  get: publicProcedure
    .input(z.object({ runId: z.string(), afterSeq: z.number().int().min(0).optional() }))
    .query(({ input }) => {
      return getRunStore().getRun(input.runId, input.afterSeq ?? 0)
    }),

  list: publicProcedure
    .input(
      z
        .object({
          subChatId: z.string().optional(),
          activeOnly: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      return getRunStore().listRuns(input)
    }),

  /**
   * Live run feed. On open the subscription replays a snapshot, then goes
   * live. The listener is registered before the replay reads, and both run
   * in one synchronous turn, so no event can slip between them; anything
   * that still lands during the replay is buffered and deduped by seq.
   */
  subscribe: publicProcedure
    .input(
      z
        .object({
          subChatId: z.string().optional(),
          afterSeq: z.number().int().min(0).optional(),
          runId: z.string().optional(),
        })
        .optional(),
    )
    .subscription(({ input }) => {
      return observable<RunsFeedItem>((emit) => {
        const store = getRunStore()
        const subChatId = input?.subChatId
        const buffered: RunsFeedItem[] = []
        let replayDone = false

        const unsubscribe = store.subscribe(
          (item) => {
            if (replayDone) {
              emit.next(item)
            } else {
              buffered.push(item)
            }
          },
          subChatId ? { subChatId } : undefined,
        )

        // A replay failure must not leak the listener registered above:
        // release it before the error leaves the setup function.
        let replayedSeqByRun: Map<string, number>
        try {
          replayedSeqByRun = replaySnapshot(store, emit, subChatId, input?.afterSeq, input?.runId)
        } catch (error) {
          unsubscribe()
          throw error
        }

        replayDone = true
        for (const item of buffered) {
          const seq = item.event?.seq
          if (seq !== undefined && seq <= (replayedSeqByRun.get(item.run.id) ?? -1)) continue
          emit.next(item)
        }

        return unsubscribe
      })
    }),
})
