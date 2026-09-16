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
 * Seeds the store with terminal error statuses that survived a reload. The
 * live feed only replays active runs, so a sub-chat whose latest run settled
 * in error would otherwise show ready. Sub-chats with a live status already
 * belong to the feed, and ready is the default, so error is the only status
 * worth writing here.
 */
export function hydrateErrorStatusesFromLatestRuns(
  subChats: Array<{ id: string; latestRun: { status: string } | null }>,
): void {
  const { statuses, setStatus } = useStreamingStatusStore.getState()
  for (const subChat of subChats) {
    if (!subChat.latestRun) continue
    const mapped = runStatusToStreamingStatus(subChat.latestRun.status)
    const current = statuses[subChat.id]
    if (current === undefined) {
      if (mapped === "error") setStatus(subChat.id, "error")
      continue
    }
    // A lingering error from an older run must yield to a newer settled
    // run; the feed owns every other live status.
    if (current === "error" && mapped !== "error") setStatus(subChat.id, mapped)
  }
}

/**
 * Repairs statuses left stale by an outage. The replay only covers active
 * runs, so a run that settled while the feed was down would stay streaming
 * here forever. Every sub-chat this window still considers busy is checked
 * against its newest run; if the engine has no active run for it, the newest
 * run is the settled one and its status is the truth. The statuses reference
 * is captured right before each lookup, and any write during that lookup
 * means a live event landed, so the repair backs off instead of risking an
 * overwrite of a fresh run's status.
 */
async function reconcileStaleStreaming(client: RunsFeedClient): Promise<void> {
  const busyIds = Object.entries(useStreamingStatusStore.getState().statuses)
    .filter(([, status]) => status === "streaming" || status === "submitted")
    .map(([subChatId]) => subChatId)
  for (const subChatId of busyIds) {
    try {
      const statusesBeforeLookup = useStreamingStatusStore.getState().statuses
      const status = statusesBeforeLookup[subChatId]
      if (status !== "streaming" && status !== "submitted") continue
      const [latest] = await client.runs.list.query({ subChatId, limit: 1 })
      if (!latest || useStreamingStatusStore.getState().statuses !== statusesBeforeLookup) continue
      useStreamingStatusStore
        .getState()
        .setStatus(subChatId, runStatusToStreamingStatus(latest.status))
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
