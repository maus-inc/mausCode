/**
 * Queue router (roadmap step 08): read, write and claim the main-owned queue.
 *
 * `claim` is the hand-off. Every other procedure is bookkeeping the window
 * performs around the send it owns. Design contract:
 * `.dump/app/plans/2026-09-17-queue-in-main.md`.
 */
import { observable } from "@trpc/server/observable"
import { z } from "zod"
import { queuePayloadSchema } from "../../../../shared/queue-item"
import { getQueueStore, type QueueFeedItem } from "../../queue"
import { publicProcedure, router } from "../index"

/** The feed payload both processes agree on; re-exported for the projection. */
export type { QueueFeedItem }

const subChatInput = z.object({ subChatId: z.string().min(1) })
const itemInput = z.object({ subChatId: z.string().min(1), itemId: z.string().min(1) })

export const queueRouter = router({
  add: publicProcedure
    .input(z.object({ subChatId: z.string().min(1), payload: queuePayloadSchema }))
    .mutation(({ input }) => {
      return getQueueStore().add({ subChatId: input.subChatId, payload: input.payload })
    }),

  remove: publicProcedure.input(itemInput).mutation(({ input }) => {
    return getQueueStore().remove(input.subChatId, input.itemId)
  }),

  /**
   * Drop every row of a sub-chat. Deleting the sub-chat already cascades its
   * rows, so this exists for the window that still shows them: it is not a
   * "clear the queue" action while a send is in flight, because a claimed row
   * is the claiming window's to finish.
   */
  clear: publicProcedure.input(subChatInput).mutation(({ input }) => {
    return getQueueStore().clear(input.subChatId)
  }),

  /** Reorder by visible index, the reading `projects.reorder` established. */
  move: publicProcedure
    .input(itemInput.extend({ index: z.number().int().min(0) }))
    .mutation(({ input }) => {
      return getQueueStore().move(input.subChatId, input.itemId, input.index)
    }),

  list: publicProcedure.input(subChatInput).query(({ input }) => {
    return getQueueStore().list(input.subChatId)
  }),

  /**
   * The dispatch decision. Without `itemId` main hands over the oldest pending
   * item and refuses while the sub-chat is busy or paused; with `itemId` the
   * user asked for that item now, so the caller stops the current turn itself.
   * Exactly one caller receives a row.
   */
  claim: publicProcedure
    .input(
      z.object({
        subChatId: z.string().min(1),
        itemId: z.string().min(1).optional(),
        /**
         * The window asking, so main can tell a claim that is still live from
         * one its window abandoned, and can hand back what a closed window
         * held. The renderer reads it from the same place its storage
         * namespacing does.
         */
        owner: z.string().min(1),
      }),
    )
    .mutation(({ input }) => {
      return getQueueStore().claim({
        subChatId: input.subChatId,
        itemId: input.itemId,
        owner: input.owner,
      })
    }),

  /** Records the hand-off, and it is the only writer of `handedAt`. */
  markHanded: publicProcedure
    .input(itemInput.extend({ owner: z.string().min(1) }))
    .mutation(({ input }) => {
      return getQueueStore().markHanded(input.subChatId, input.itemId, input.owner)
    }),

  /**
   * Holds a row whose send was handed over but never reported a turn. The row
   * stays visible and out of the automatic path, so a resume cannot send it a
   * second time.
   */
  park: publicProcedure.input(itemInput).mutation(({ input }) => {
    return getQueueStore().park(input.subChatId, input.itemId)
  }),

  complete: publicProcedure.input(itemInput).mutation(({ input }) => {
    return getQueueStore().complete(input.subChatId, input.itemId)
  }),

  requeue: publicProcedure.input(itemInput).mutation(({ input }) => {
    return getQueueStore().requeue(input.subChatId, input.itemId)
  }),

  /** A manual stop pauses the queue; an explicit send resumes it. */
  setPaused: publicProcedure
    .input(z.object({ subChatId: z.string().min(1), paused: z.boolean() }))
    .mutation(({ input }) => {
      return getQueueStore().setPaused(input.subChatId, input.paused)
    }),

  /**
   * Live queue feed. On open it replays the current state, then goes live.
   * The listener is registered before the replay reads and both run in one
   * synchronous turn, so nothing slips between them; anything that still lands
   * during the replay is buffered and emitted after it, in order.
   */
  subscribe: publicProcedure
    .input(z.object({ subChatId: z.string().min(1).optional() }).optional())
    .subscription(({ input }) => {
      return observable<QueueFeedItem>((emit) => {
        const store = getQueueStore()
        const subChatId = input?.subChatId
        const buffered: QueueFeedItem[] = []
        let replayDone = false

        const unsubscribe = store.subscribe((item) => {
          if (subChatId && item.subChatId !== subChatId) return
          if (replayDone) {
            emit.next(item)
          } else {
            buffered.push(item)
          }
        })

        let snapshot: QueueFeedItem[]
        try {
          // A replay failure must not leak the listener registered above.
          snapshot = subChatId ? [{ subChatId, items: store.list(subChatId) }] : store.listAll()
        } catch (error) {
          unsubscribe()
          throw error
        }
        for (const item of snapshot) {
          emit.next(item)
        }

        replayDone = true
        for (const item of buffered) {
          emit.next(item)
        }

        return unsubscribe
      })
    }),
})
