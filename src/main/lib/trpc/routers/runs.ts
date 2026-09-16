/**
 * Runs router (roadmap step 07): read and subscribe to the main-owned run
 * record. `get` replays events past a cursor, `list` returns run rows, and
 * `subscribe` replays a snapshot on open, then streams live transitions.
 * Design contract: `.dump/app/plans/2026-09-13-run-state.md`.
 */
import { observable } from "@trpc/server/observable"
import { z } from "zod"
import type { Run, RunEvent } from "../../db/schema"
import { getRunStore } from "../../runs"
import { publicProcedure, router } from "../index"

export interface RunsFeedItem {
  run: Run
  event: RunEvent | null
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
   * Live run feed. On open the subscription replays, then goes live: with
   * `subChatId` and `afterSeq` it replays that sub-chat's newest run events
   * past the cursor; with `subChatId` alone it emits a snapshot item for the
   * newest run; with neither it emits a snapshot item per active run. Live
   * items whose seq the replay already covered are dropped, so a consumer
   * never sees an event twice.
   */
  subscribe: publicProcedure
    .input(
      z
        .object({
          subChatId: z.string().optional(),
          afterSeq: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .subscription(({ input }) => {
      return observable<RunsFeedItem>((emit) => {
        const store = getRunStore()
        const subChatId = input?.subChatId
        const afterSeq = input?.afterSeq
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

        // The listener is registered before the replay reads below, and both
        // run in one synchronous turn, so no event can slip between them.
        const replayedSeqByRun = new Map<string, number>()
        if (subChatId) {
          const latest = store.listRuns({ subChatId, limit: 1 })[0]
          if (latest) {
            if (typeof afterSeq === "number") {
              const withEvents = store.getRun(latest.id, afterSeq)
              if (withEvents) {
                for (const event of withEvents.events) {
                  emit.next({ run: withEvents.run, event })
                  replayedSeqByRun.set(latest.id, event.seq)
                }
              }
            } else {
              emit.next({ run: latest, event: null })
              replayedSeqByRun.set(latest.id, latest.lastSeq)
            }
          }
        } else {
          for (const run of store.activeRuns()) {
            emit.next({ run, event: null })
            replayedSeqByRun.set(run.id, run.lastSeq)
          }
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
