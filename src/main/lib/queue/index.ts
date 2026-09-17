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
export function recoverQueuedSends(): number {
  try {
    const recovered = getQueueStore().recoverSending()
    if (recovered > 0) {
      console.log(`[queue] recovered ${recovered} interrupted send(s) at startup`)
    }
    return recovered
  } catch (error) {
    console.error("[queue] startup recovery failed:", error)
    return 0
  }
}

export type {
  AddQueueItemInput,
  ClaimQueueItemInput,
  QueueFeedItem,
  QueueStore,
} from "./queue-state"
