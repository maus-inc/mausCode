/**
 * Main-process entry point for the queue store (roadmap step 08). Kept apart
 * from `queue-state.ts` so the store itself stays free of Electron imports and
 * testable against an injected database.
 */
import { getDatabase } from "../db"
import { createQueueStore, type QueueStore } from "./queue-state"

let queueStore: QueueStore | null = null

export function getQueueStore(): QueueStore {
  queueStore ??= createQueueStore(getDatabase())
  return queueStore
}

/**
 * Startup recovery hook, called once after migrations run. A claimed item
 * whose send never started is returned to the queue, because no window can
 * hold a claim across a restart. A failure here must never block app startup,
 * so it logs and continues.
 */
export function recoverQueuedSends(attempts = 3): number {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const recovered = getQueueStore().recoverSending()
      if (recovered > 0) {
        console.log(`[queue] recovered ${recovered} interrupted send(s) at startup`)
      }
      return recovered
    } catch (error) {
      // Losing this pass leaves rows `sending`, which blocks dispatch for those
      // sub-chats, so it is retried rather than logged and forgotten. Startup
      // is never blocked by it: the last failure is reported and the app runs.
      const last = attempt === attempts
      console.error(`[queue] startup recovery failed (attempt ${attempt}/${attempts}):`, error)
      if (last) return 0
    }
  }
  return 0
}

/**
 * Hand back the claims of a window that closed. Called from the main process
 * when the window is gone, which is the one moment the app can know that a
 * `sending` row no longer has an owner: without it, that row blocks the
 * sub-chat's queue until the next app start.
 */
export function releaseQueueClaimsForWindow(windowId: string): number {
  try {
    return getQueueStore().releaseOwner(windowId)
  } catch (error) {
    console.error(`[queue] could not release claims of window ${windowId}:`, error)
    return 0
  }
}

export type {
  AddQueueItemInput,
  ClaimQueueItemInput,
  QueueFeedItem,
  QueueStore,
} from "./queue-state"
