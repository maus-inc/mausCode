/**
 * Run feed projection tests (roadmap step 07). Drives the projection with a
 * fake feed client and asserts what the streaming status store shows.
 */
import { beforeEach, describe, expect, it } from "vitest"
import type { RunsFeedItem } from "../../../../main/lib/trpc/routers/runs"
import {
  applyRunFeedItem,
  hydrateErrorStatusesFromLatestRuns,
  type RunsFeedClient,
  runStatusToStreamingStatus,
  startRunFeedSync,
} from "./run-feed-projection"
import { useStreamingStatusStore } from "./streaming-status-store"

type Item = RunsFeedItem
type Handlers = { onData: (item: Item) => void; onError?: (error: Error) => void }

function run(id: string, subChatId: string, status: string, lastSeq: number): Item {
  return {
    run: {
      id,
      subChatId,
      status,
      startedAt: new Date(),
      endedAt: null,
      stopReason: null,
      approvalPending: false,
      engine: "legacy",
      provider: null,
      model: null,
      lastSeq,
    },
    event: null,
  }
}

function liveEvent(item: Item, kind: string, seq: number): Item {
  return {
    ...item,
    run: { ...item.run, lastSeq: seq },
    event: {
      id: `ev-${seq}`,
      runId: item.run.id,
      seq,
      kind,
      payload: "{}",
      at: new Date(),
    },
  }
}

function fakeClient(
  script: (emit: (item: Item) => void, fail: (error: Error) => void) => void,
  listRuns: (subChatId: string) => Array<{ subChatId: string; status: string }> = () => [],
): {
  client: RunsFeedClient
  connections: number
  unsubscribes: number
} {
  let connections = 0
  let unsubscribes = 0
  const client: RunsFeedClient = {
    runs: {
      subscribe: {
        subscribe: (_input, handlers: Handlers) => {
          connections += 1
          script(
            (item) => handlers.onData(item),
            (error) => handlers.onError?.(error),
          )
          return {
            unsubscribe: () => {
              unsubscribes += 1
            },
          }
        },
      },
      list: {
        query: (input) => Promise.resolve(listRuns(input?.subChatId ?? "")),
      },
    },
  }
  return {
    client,
    get connections() {
      return connections
    },
    get unsubscribes() {
      return unsubscribes
    },
  }
}

describe("run feed projection", () => {
  beforeEach(() => {
    useStreamingStatusStore.setState({ statuses: {} })
  })

  it("maps run statuses onto streaming statuses", () => {
    expect(runStatusToStreamingStatus("running")).toBe("streaming")
    expect(runStatusToStreamingStatus("waiting_approval")).toBe("streaming")
    expect(runStatusToStreamingStatus("error")).toBe("error")
    expect(runStatusToStreamingStatus("completed")).toBe("ready")
    expect(runStatusToStreamingStatus("cancelled")).toBe("ready")
    expect(runStatusToStreamingStatus("interrupted")).toBe("ready")
    expect(runStatusToStreamingStatus("some_future_state")).toBe("ready")
  })

  it("applies snapshot and live items to the store", () => {
    const stop = startRunFeedSync(
      fakeClient((emit) => {
        emit(run("r1", "sub-a", "running", 1))
        emit(liveEvent(run("r1", "sub-a", "completed", 5), "settled", 5))
      }).client,
    )

    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("ready")
    stop()
  })

  it("drops items at or below the last applied seq", () => {
    const lastAppliedSeq = new Map<string, number>()
    const base = run("r1", "sub-a", "running", 3)

    applyRunFeedItem(liveEvent(base, "x", 3), lastAppliedSeq)
    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("streaming")

    // An older replay arrives after a newer event: it must not win.
    useStreamingStatusStore.getState().setStatus("sub-a", "ready")
    applyRunFeedItem(liveEvent(base, "x", 2), lastAppliedSeq)
    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("ready")

    applyRunFeedItem(liveEvent(run("r1", "sub-a", "waiting_approval", 4), "x", 4), lastAppliedSeq)
    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("streaming")
  })

  it("two windows converging on the same feed see identical status", () => {
    const item = run("r1", "sub-a", "waiting_approval", 2)
    const stopA = startRunFeedSync(fakeClient((emit) => emit(item)).client)
    const stopB = startRunFeedSync(fakeClient((emit) => emit(item)).client)

    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("streaming")
    stopA()
    stopB()
  })

  it("hydrates persisted error statuses without touching live ones", () => {
    useStreamingStatusStore.getState().setStatus("sub-live", "streaming")

    hydrateErrorStatusesFromLatestRuns([
      { id: "sub-error", latestRun: { status: "error" } },
      { id: "sub-done", latestRun: { status: "completed" } },
      { id: "sub-live", latestRun: { status: "error" } },
      { id: "sub-none", latestRun: null },
    ])

    const statuses = useStreamingStatusStore.getState().statuses
    expect(statuses["sub-error"]).toBe("error")
    // ready is the default, so settled runs write nothing
    expect(statuses["sub-done"]).toBeUndefined()
    // a live status belongs to the feed and is never overwritten
    expect(statuses["sub-live"]).toBe("streaming")
    expect(statuses["sub-none"]).toBeUndefined()
  })

  it("reconnects after a feed error", async () => {
    let attempt = 0
    const fake = fakeClient((emit, fail) => {
      attempt += 1
      if (attempt === 1) {
        emit(run("r1", "sub-a", "running", 1))
        fail(new Error("ipc gone"))
      } else {
        emit(run("r1", "sub-a", "running", 1))
      }
    })

    const stop = startRunFeedSync(fake.client, 10)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fake.connections).toBe(2)
    // The dead first subscription must be torn down before the retry opens
    // the second one.
    expect(fake.unsubscribes).toBe(1)
    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("streaming")
    stop()
    expect(fake.unsubscribes).toBe(2)
  })

  it("repairs a stale streaming status after a run settles during an outage", async () => {
    let attempt = 0
    // The replay only covers active runs, so the reconnect emits nothing for
    // the run that settled while the feed was down. The latest-run lookup is
    // the only path that can repair the stale streaming status.
    const fake = fakeClient(
      (emit, fail) => {
        attempt += 1
        if (attempt === 1) {
          emit(run("r1", "sub-a", "running", 1))
          fail(new Error("ipc gone"))
        }
      },
      (subChatId) => (subChatId === "sub-a" ? [{ subChatId: "sub-a", status: "completed" }] : []),
    )

    const stop = startRunFeedSync(fake.client, 10)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fake.connections).toBe(2)
    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("ready")
    stop()
  })
})
