/**
 * Run feed projection (roadmap step 07). Opens one `runs.subscribe` per
 * window and maps the main-owned run record onto the streaming status store.
 * The subscription replays a snapshot of active runs on open, then streams
 * live transitions, so a reload or a second window sees the same truth the
 * owning window sees. Items at or below the last applied seq for a run are
 * dropped, which makes replays and double subscriptions harmless.
 */
import type { RunsFeedItem } from "../../../../main/lib/trpc/routers/runs"
import { trpcClient } from "../../../lib/trpc"
import { type StreamingStatus, useStreamingStatusStore } from "./streaming-status-store"

export type RunsFeedClient = {
  runs: {
    subscribe: {
      subscribe: (
        input: { subChatId?: string; afterSeq?: number } | undefined,
        handlers: {
          onData: (item: RunsFeedItem) => void
          onError?: (error: Error) => void
        },
      ) => { unsubscribe: () => void }
    }
  }
}

const FEED_RETRY_DELAY_MS = 2000

// Accepts the database text value; unknown future statuses degrade to ready.
export function runStatusToStreamingStatus(status: string): StreamingStatus {
  switch (status) {
    case "running":
    case "waiting_approval":
      return "streaming"
    case "error":
      return "error"
    default:
      return "ready"
  }
}

export function applyRunFeedItem(item: RunsFeedItem, lastAppliedSeq: Map<string, number>): void {
  const seq = item.event ? item.event.seq : item.run.lastSeq
  const seen = lastAppliedSeq.get(item.run.id)
  if (seen !== undefined && seq <= seen) return
  lastAppliedSeq.set(item.run.id, seq)
  useStreamingStatusStore
    .getState()
    .setStatus(item.run.subChatId, runStatusToStreamingStatus(item.run.status))
}

/**
 * Start the projection. Returns a stop function that unsubscribes and
 * cancels any pending retry.
 */
export function startRunFeedSync(
  client: RunsFeedClient = trpcClient,
  retryDelayMs: number = FEED_RETRY_DELAY_MS,
): () => void {
  const lastAppliedSeq = new Map<string, number>()
  let stopped = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let subscription: { unsubscribe: () => void } | null = null

  const connect = () => {
    if (stopped) return
    // The previous subscription is dead after an error, but its transport
    // resources still exist; release them before opening the replacement.
    subscription?.unsubscribe()
    subscription = client.runs.subscribe.subscribe(undefined, {
      onData: (item) => {
        applyRunFeedItem(item, lastAppliedSeq)
      },
      onError: (error) => {
        console.error("[run-feed] subscription error, retrying:", error.message)
        if (stopped || retryTimer) return
        retryTimer = setTimeout(() => {
          retryTimer = null
          connect()
        }, retryDelayMs)
      },
    })
  }

  connect()

  return () => {
    stopped = true
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    subscription?.unsubscribe()
    subscription = null
  }
}
