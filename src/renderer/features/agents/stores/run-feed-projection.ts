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

export type RunsFeedItemStatus = { subChatId: string; status: string }

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
    list: {
      query: (
        input: { subChatId?: string; limit?: number } | undefined,
      ) => Promise<RunsFeedItemStatus[]>
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

/**
 * Sub-chats whose current error status came from a run row, either through
 * the live feed, the reconciliation below, or the hydration below. Errors
 * set anywhere else, like the queue processor marking a local send failure,
 * are absent here and therefore survive hydration, because no run row exists
 * to clear them.
 */
const errorFromRunRow = new Set<string>()

/**
 * Per-sub-chat revision bumped every time a feed item lands. Reconciliation
 * captures it before the asynchronous lookup and backs off when it moved,
 * which catches live events that mapped to the same status and therefore
 * left the status comparison unchanged.
 */
const feedRevisionBySubChat = new Map<string, number>()

function writeProjectedStatus(subChatId: string, status: StreamingStatus): void {
  if (status === "error") errorFromRunRow.add(subChatId)
  else errorFromRunRow.delete(subChatId)
  useStreamingStatusStore.getState().setStatus(subChatId, status)
}

export function applyRunFeedItem(item: RunsFeedItem, lastAppliedSeq: Map<string, number>): void {
  const seq = item.event ? item.event.seq : item.run.lastSeq
  const seen = lastAppliedSeq.get(item.run.id)
  if (seen !== undefined && seq <= seen) return
  lastAppliedSeq.set(item.run.id, seq)
  feedRevisionBySubChat.set(
    item.run.subChatId,
    (feedRevisionBySubChat.get(item.run.subChatId) ?? 0) + 1,
  )
  writeProjectedStatus(item.run.subChatId, runStatusToStreamingStatus(item.run.status))
}

/**
 * Seeds the store with terminal error statuses that survived a reload. The
 * live feed only replays active runs, so a sub-chat whose latest run settled
 * in error would otherwise show ready. Sub-chats with a live status already
 * belong to the feed, and ready is the default, so error is the only status
 * worth writing here.
 */
export function hydrateErrorStatusesFromLatestRuns(
  subChats: Array<{ id: string; latestRun: { status: string } | null }>,
): void {
  const { statuses } = useStreamingStatusStore.getState()
  for (const subChat of subChats) {
    if (!subChat.latestRun) continue
    const mapped = runStatusToStreamingStatus(subChat.latestRun.status)
    const current = statuses[subChat.id]
    if (current === undefined) {
      if (mapped === "error") writeProjectedStatus(subChat.id, "error")
      continue
    }
    // A lingering error written by an older run row yields to a newer settled
    // run. Every other error, including a local send failure, stays put.
    if (current === "error" && mapped !== "error" && errorFromRunRow.has(subChat.id)) {
      writeProjectedStatus(subChat.id, mapped)
    }
  }
}

/**
 * Repairs statuses left stale by an outage. The replay only covers active
 * runs, so a run that settled while the feed was down would stay streaming
 * here forever. Every sub-chat this window still considers busy is checked
 * against its newest run; if the engine has no active run for it, the newest
 * run is the settled one and its status is the truth. The repair backs off
 * when the sub-chat's own status changed during the lookup, or when any feed
 * item landed for it, even one that mapped to the same status; the revision
 * counter is what catches that same-value case. The comparison is per
 * sub-chat, so writes for other sub-chats cannot stall the remaining
 * repairs.
 */
async function reconcileStaleStreaming(client: RunsFeedClient): Promise<void> {
  const busyIds = Object.entries(useStreamingStatusStore.getState().statuses)
    .filter(([, status]) => status === "streaming" || status === "submitted")
    .map(([subChatId]) => subChatId)
  for (const subChatId of busyIds) {
    try {
      const statusBeforeLookup = useStreamingStatusStore.getState().statuses[subChatId]
      if (statusBeforeLookup !== "streaming" && statusBeforeLookup !== "submitted") continue
      const revisionBeforeLookup = feedRevisionBySubChat.get(subChatId) ?? 0
      const [latest] = await client.runs.list.query({ subChatId, limit: 1 })
      if (!latest) continue
      if (useStreamingStatusStore.getState().statuses[subChatId] !== statusBeforeLookup) continue
      if ((feedRevisionBySubChat.get(subChatId) ?? 0) !== revisionBeforeLookup) continue
      writeProjectedStatus(subChatId, runStatusToStreamingStatus(latest.status))
    } catch {
      // The next reconnect retries the reconciliation.
    }
  }
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
    void reconcileStaleStreaming(client)
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
