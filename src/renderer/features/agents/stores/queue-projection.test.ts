/**
 * Queue projection tests (roadmap step 08). Drives the projection with a fake
 * tRPC client and a fake chat, and asserts the rules that make two windows
 * safe: main decides who gets an item, a window that cannot send never asks,
 * and a failed send is handed back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "../../../../shared/queue-item"

const sendClaimedQueueItem = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock("../lib/queue-send", () => ({ sendClaimedQueueItem }))
vi.mock("../../../contexts/WindowContext", () => ({ getWindowId: () => "window-7" }))
vi.mock("sonner", () => ({ toast: { error: toastError } }))

import type { QueueFeedItem } from "../../../../main/lib/trpc/routers/queue"
import { agentChatStore } from "./agent-chat-store"
import {
  addQueueItem,
  applyQueueFeedItem,
  clearQueueItems,
  hasQueuedMessages,
  type QueueFeedClient,
  removeQueueItem,
  resumeQueue,
  sendQueueItemNow,
  setQueuePaused,
  startQueueSync,
  useQueueProjection,
  wakeQueue,
} from "./queue-projection"
import { useStreamingStatusStore } from "./streaming-status-store"

function item(id: string, subChatId: string, status: QueueItem["status"]): QueueItem {
  return {
    id,
    subChatId,
    position: 1024,
    status,
    payload: { message: id },
    createdAt: new Date(),
    dispatchedAt: null,
  }
}

function feed(subChatId: string, items: QueueItem[]): QueueFeedItem {
  return { subChatId, items }
}

function fakeClient(options: { claimed?: QueueItem[]; handed?: boolean } = {}) {
  const claims: Array<{ itemId?: string; owner: string }> = []
  const completed: string[] = []
  const requeued: string[] = []
  const parked: string[] = []
  /** The window each park and complete named, so a dropped owner is visible. */
  const parkedBy: string[] = []
  const completedBy: string[] = []
  const handed: string[] = []
  const paused: Array<{ subChatId: string; paused: boolean }> = []
  /** Every claim/hand-off/complete/resume in the order they reached main. */
  const calls: string[] = []
  let handOffAllowed = options.handed ?? true
  let onFeed: ((item: QueueFeedItem) => void) | null = null
  let onFeedError: ((error: Error) => void) | null = null
  let subscribes = 0
  const queue = {
    claimed: options.claimed ?? [],
    subscribe: {
      subscribe: (
        _input: unknown,
        handlers: { onData?: (item: QueueFeedItem) => void; onError?: (error: Error) => void },
      ) => {
        subscribes += 1
        onFeed = handlers.onData ?? null
        onFeedError = handlers.onError ?? null
        return {
          unsubscribe: () => {
            onFeed = null
          },
        }
      },
    },
    add: {
      // A `vi.fn` so a test can make the add fail; the composer's draft rules
      // depend on what this answers.
      mutate: vi.fn(async (input: { subChatId: string; payload: { message: string } }) => {
        calls.push(`add:${input.payload.message}`)
        return { ...item("added", input.subChatId, "pending"), payload: input.payload }
      }),
    },
    remove: { mutate: vi.fn() },
    clear: { mutate: vi.fn() },
    claim: {
      // A `vi.fn` so a test can make the question fail before main answers it,
      // which is the failure the feed cannot correct on its own.
      mutate: vi.fn(async (input: { subChatId: string; itemId?: string; owner: string }) => {
        claims.push({ itemId: input.itemId, owner: input.owner })
        calls.push(`claim:${input.itemId ?? "head"}`)
        return queue.claimed.shift() ?? null
      }),
    },
    markHanded: {
      mutate: async (input: { subChatId: string; itemId: string; owner: string }) => {
        calls.push(`markHanded:${input.itemId}`)
        if (!handOffAllowed) return false
        handed.push(`${input.itemId}:${input.owner}`)
        return true
      },
    },
    park: {
      mutate: async (input: { subChatId: string; itemId: string; owner: string }) => {
        parked.push(input.itemId)
        parkedBy.push(input.owner)
        calls.push(`park:${input.itemId}`)
        return true
      },
    },
    complete: {
      // A `vi.fn` so a test can make one attempt fail; the retry is otherwise
      // invisible through this fake.
      mutate: vi.fn(async (input: { subChatId: string; itemId: string; owner: string }) => {
        completed.push(input.itemId)
        completedBy.push(input.owner)
        calls.push(`complete:${input.itemId}`)
        return true
      }),
    },
    requeue: {
      mutate: async (input: { subChatId: string; itemId: string; owner: string }) => {
        requeued.push(input.itemId)
        calls.push(`requeue:${input.itemId}`)
        return true
      },
    },
    setPaused: {
      // A `vi.fn` so a test can make the pause fail, which is the answer the
      // stop button warns about.
      mutate: vi.fn(async (input: { subChatId: string; paused: boolean }) => {
        paused.push(input)
        calls.push(`setPaused:${input.paused}`)
        return 0
      }),
    },
  }
  return {
    client: { owner: "window-test", queue } as unknown as QueueFeedClient,
    queue,
    /** Land a feed on the live subscription, the way main's emits arrive. */
    pushFeed: (payload: QueueFeedItem) => onFeed?.(payload),
    /** Drop the live subscription, the way a closed transport does. */
    dropFeed: () => onFeedError?.(new Error("feed down")),
    get subscribes() {
      return subscribes
    },
    claims,
    completed,
    completedBy,
    requeued,
    parked,
    parkedBy,
    handed,
    paused,
    calls,
    refuseHandOff: () => {
      handOffAllowed = false
    },
  }
}

function registerChat(
  subChatId: string,
  status: "ready" | "submitted" | "streaming" = "ready",
): { sendMessage: ReturnType<typeof vi.fn>; status: string } {
  const chat = { sendMessage: vi.fn(), status }
  agentChatStore.set(subChatId, chat as never, "parent-1")
  return chat
}

/**
 * A wake that finds no pane leaves a bounded retry pending, and that timer
 * closes over the fake client of the test that scheduled it. Cancel whatever a
 * previous test left, so no test inherits another's timer or another's client.
 */
function cancelPendingWakeRetries(): void {
  startQueueSync(fakeClient().client)()
}

describe("queue projection", () => {
  beforeEach(() => {
    cancelPendingWakeRetries()
    // A full reset, not just the cards: the marks and the hidden counts live
    // outside the store, and a test that leaves one behind decides what a later
    // test sends. This is the same reset a reconnect performs.
    useQueueProjection.getState().resetQueues()
    useStreamingStatusStore.setState({ statuses: {} })
    agentChatStore.clear()
    sendClaimedQueueItem.mockReset()
    sendClaimedQueueItem.mockResolvedValue("sent")
    toastError.mockClear()
  })

  // The retry tests run on fake timers; a failure inside one must not leave
  // them on for every test after it.
  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps the card rows and hides the row being sent", () => {
    applyQueueFeedItem(
      feed("sub-a", [
        item("q1", "sub-a", "pending"),
        item("q2", "sub-a", "sending"),
        item("q3", "sub-a", "paused"),
      ]),
      fakeClient().client,
    )

    expect(useQueueProjection.getState().queues["sub-a"].map((row) => row.id)).toEqual(["q1", "q3"])
  })

  it("claims the head and completes it when the send starts", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")

    await wakeQueue("sub-a", fake.client)

    expect(fake.claims).toEqual([{ itemId: undefined, owner: "window-test" }])
    expect(sendClaimedQueueItem).toHaveBeenCalledTimes(1)
    expect(fake.completed).toEqual(["q1"])
    // Same reason as the park below: this delete is owner-scoped in main, so a
    // dropped owner would leave the row `sending` with nobody to settle it.
    expect(fake.completedBy).toEqual(["window-test"])
    expect(fake.requeued).toEqual([])
  })

  it("hands the item back when the send never starts", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")
    sendClaimedQueueItem.mockResolvedValue("failed")

    await wakeQueue("sub-a", fake.client)

    expect(fake.completed).toEqual([])
    expect(fake.requeued).toEqual(["q1"])
    // The failure marks the pane, so the requeue's own feed change cannot
    // claim the same row again in a loop.
    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("error")
  })

  it("parks the row when the send was handed over without a turn start", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")
    // The send call rejected after this window recorded the hand-off, so the
    // message may or may not have reached the engine.
    sendClaimedQueueItem.mockResolvedValueOnce("uncertain")

    await wakeQueue("sub-a", fake.client)

    expect(fake.parked).toEqual(["q1"])
    // The park is the claiming window's own write: main matches the owner, so a
    // dropped owner here would leave the row `sending` with nobody to settle it.
    expect(fake.parkedBy).toEqual(["window-test"])
    // Neither retired nor put back: nothing may send it a second time on its own.
    expect(fake.completed).toEqual([])
    expect(fake.requeued).toEqual([])
    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("error")
  })

  it("records nothing when the claim moved on before the send", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")
    // The row was cleared or taken over, so it is not this window's to retire,
    // hand back, or park.
    sendClaimedQueueItem.mockResolvedValueOnce("cancelled")

    await wakeQueue("sub-a", fake.client)

    expect(fake.completed).toEqual([])
    expect(fake.requeued).toEqual([])
    expect(fake.parked).toEqual([])
    expect(fake.calls).toEqual(["claim:head"])
  })

  it("names this window when the client does not, which is what main keys a claim by", async () => {
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })
    registerChat("sub-a")

    // The real client is a plain tRPC proxy with no owner of its own, so the
    // id comes from the window context. Main keys the claim by it — that is how
    // it tells a live window from one that reloaded, and how a closed window's
    // claims are released — so a wrong id here would let one window settle
    // another window's row.
    const client = { ...fake.client, owner: undefined } as QueueFeedClient
    await wakeQueue("sub-a", client)

    expect(fake.claims).toEqual([{ itemId: undefined, owner: "window-7" }])
  })

  it("ignores a second Send now while the first is still working", async () => {
    const first = item("q1", "sub-a", "pending")
    const second = item("q2", "sub-a", "pending")
    const fake = fakeClient({ claimed: [first, second] })
    registerChat("sub-a")
    // Hold the first click's send open, so the second arrives while this
    // sub-chat is already in flight.
    let release: () => void = () => {}
    sendClaimedQueueItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve("sent")
        }),
    )

    const sending = sendQueueItemNow("sub-a", "q1", async () => true, fake.client)
    await vi.waitFor(() => expect(sendClaimedQueueItem).toHaveBeenCalledTimes(1))

    // A second click names another row. Main would hand it over — one row per
    // request — and both rows would then be sent for one sub-chat.
    await expect(sendQueueItemNow("sub-a", "q2", async () => true, fake.client)).resolves.toBe(
      false,
    )
    expect(fake.claims).toHaveLength(1)

    release()
    await sending
    expect(fake.claims).toHaveLength(1)
  })

  it("drops cards main no longer has when the feed reconnects", async () => {
    vi.useFakeTimers()
    const fake = fakeClient()
    const stop = startQueueSync(fake.client, 1_000)
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    expect(useQueueProjection.getState().queues["sub-a"]).toHaveLength(1)

    // The transport drops. Whatever the card held is older than main's truth,
    // and the replay that follows the reconnect is what fills it again.
    fake.dropFeed()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(useQueueProjection.getState().queues["sub-a"]).toBeUndefined()
    expect(fake.subscribes).toBe(2)
    stop()
  })

  it("does not reopen the feed after the sync has stopped", async () => {
    vi.useFakeTimers()
    const fake = fakeClient()
    const stop = startQueueSync(fake.client, 1_000)
    expect(fake.subscribes).toBe(1)

    // The transport drops and the reconnect is scheduled, and then the mount
    // goes away: a stopped window must not reopen the feed behind its own back.
    fake.dropFeed()
    stop()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(fake.subscribes).toBe(1)
  })

  it("hands a claimed row straight back when the sub-chat is gone", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")
    // Clearing marks the sub-chat as having no queue in main, which is what a
    // deletion does. The claim was already in flight when that happened.
    await clearQueueItems("sub-a", fake.client)

    await wakeQueue("sub-a", fake.client)

    // A claimed row is hidden from the feed, so this hand-back is the only
    // thing that keeps it from sitting `sending` with nobody to send it.
    expect(fake.requeued).toEqual(["q1"])
    expect(sendClaimedQueueItem).not.toHaveBeenCalled()
  })

  it("counts a row being sent as queued work, so the chat is not evicted mid-hand-off", () => {
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "sending")]), fakeClient().client)

    expect(hasQueuedMessages("sub-a")).toBe(true)
  })

  it("keeps the card the indicator renders, with the row in flight hidden", () => {
    const withPayload: QueueItem = {
      ...item("q1", "sub-a", "pending"),
      payload: {
        message: "look at this",
        images: [{ id: "i1", url: "blob:1", mediaType: "image/png", filename: "a.png" }],
      },
    }

    applyQueueFeedItem(
      feed("sub-a", [withPayload, item("q2", "sub-a", "sending")]),
      fakeClient().client,
    )

    // The card is the payload plus the row's identity, which is what the
    // indicator's row reads: message, attachments, id and status.
    expect(useQueueProjection.getState().queues["sub-a"]).toEqual([
      { ...withPayload.payload, id: "q1", status: "pending" },
    ])
    // ... and the `sending` row still counts as queued work.
    expect(useQueueProjection.getState().hiddenCounts["sub-a"]).toBe(1)
  })

  it("reports a refused add, so the composer keeps the draft", async () => {
    const fake = fakeClient()
    fake.queue.add.mutate.mockRejectedValueOnce(new Error("main is not ready"))

    await expect(addQueueItem("sub-a", { message: "one" }, fake.client)).resolves.toBe(false)

    expect(toastError).toHaveBeenCalled()
  })

  it("queues the message when main accepts it, and says nothing", async () => {
    const fake = fakeClient()

    await expect(addQueueItem("sub-a", { message: "one" }, fake.client)).resolves.toBe(true)

    expect(fake.calls).toEqual(["add:one"])
    expect(toastError).not.toHaveBeenCalled()
  })

  it("reports a refused pause, so the stop button can warn", async () => {
    const fake = fakeClient()
    fake.queue.setPaused.mutate.mockRejectedValueOnce(new Error("database is locked"))

    await expect(setQueuePaused("sub-a", true, fake.client)).resolves.toBe(false)
  })

  it("reports a refused remove, so the card's X is not a silent no-op", async () => {
    const fake = fakeClient()
    fake.queue.remove.mutate.mockRejectedValueOnce(new Error("database is locked"))

    await removeQueueItem("sub-a", "q1", fake.client)

    expect(toastError).toHaveBeenCalled()
  })

  it("reports a resume that failed, so a paused queue is not left waiting in silence", async () => {
    const fake = fakeClient()
    fake.queue.setPaused.mutate.mockRejectedValueOnce(new Error("database is locked"))

    await resumeQueue("sub-a", fake.client)

    expect(toastError).toHaveBeenCalled()
  })

  it("re-asks after a feed arrives before the pane registered its chat", async () => {
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })
    // A reload replays the feed before the pane that owns the chat is up, so
    // the first wake has nothing to send with.
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    expect(fake.claims).toEqual([])

    registerChat("sub-a")

    await vi.waitFor(() => expect(fake.claims).toHaveLength(1), { timeout: 5000 })
    expect(fake.completed).toEqual(["q1"])
  })

  it("asks again when the claim never reached main, and sends the row when it does", async () => {
    vi.useFakeTimers()
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })
    registerChat("sub-a")

    // Nothing changed in main, so no later feed event is coming to re-ask, and
    // the sub-chat is already `ready`: this retry is the only way the row goes
    // out at all.
    fake.queue.claim.mutate.mockRejectedValueOnce(new Error("database is locked"))
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)

    await vi.advanceTimersByTimeAsync(0)
    expect(fake.completed).toEqual([])

    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(0)

    // The rejected question left nothing in `claims`; the retry is the one that
    // arrived, and the row went out.
    expect(fake.queue.claim.mutate).toHaveBeenCalledTimes(2)
    expect(fake.completed).toEqual(["q1"])
  })

  it("does not re-ask for a sub-chat with nothing queued", async () => {
    vi.useFakeTimers()
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })

    // A wake arrives before the pane is up, and this window knows of no rows
    // for the sub-chat: there is nothing to wake for, so no retry is scheduled.
    // A pane that mounts later reports its own status and wakes the queue then.
    await wakeQueue("sub-a", fake.client)
    registerChat("sub-a")
    await vi.advanceTimersByTimeAsync(20_000)

    // A timer here would be a poll, which is the thing this step deleted.
    expect(fake.queue.claim.mutate).not.toHaveBeenCalled()
  })

  it("asks again after a later failure once main has answered a claim", async () => {
    vi.useFakeTimers()
    const fake = fakeClient()
    registerChat("sub-a")
    // Spend the whole budget on a database that never answers.
    fake.queue.claim.mutate.mockRejectedValue(new Error("database is locked"))
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fake.queue.claim.mutate).toHaveBeenCalledTimes(6)

    // Main answers — nothing to send — which ends that sequence.
    fake.queue.claim.mutate.mockResolvedValue(null)
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.queue.claim.mutate).toHaveBeenCalledTimes(7)

    // The next failure gets a fresh sequence, so a transient one is still
    // re-asked instead of being charged to a sequence that ended.
    fake.queue.claim.mutate.mockRejectedValue(new Error("database is locked"))
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.queue.claim.mutate).toHaveBeenCalledTimes(8)

    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.queue.claim.mutate).toHaveBeenCalledTimes(9)
  })

  it("stops asking after a bounded number of failing claims, instead of polling", async () => {
    vi.useFakeTimers()
    const fake = fakeClient()
    registerChat("sub-a")
    fake.queue.claim.mutate.mockRejectedValue(new Error("database is locked"))
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)

    await vi.advanceTimersByTimeAsync(2_000 * 20)

    // The first question plus the budget, and no more: the row stays on the
    // card instead of being asked about on a loop.
    expect(fake.queue.claim.mutate).toHaveBeenCalledTimes(6)

    // A later real event still asks main directly; the budget bounds the
    // automatic re-asks, not the wakes.
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.queue.claim.mutate).toHaveBeenCalledTimes(7)
  })

  it("never asks while a turn is running", async () => {
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })
    registerChat("sub-a")
    useStreamingStatusStore.getState().setStatus("sub-a", "streaming")

    await wakeQueue("sub-a", fake.client)

    expect(fake.claims).toEqual([])
    expect(sendClaimedQueueItem).not.toHaveBeenCalled()
  })

  it("never asks while the window's own send is in flight", async () => {
    // The app-wide status store lags a direct send by one React render, so the
    // chat's own status is what stops a dispatch from racing the user's send.
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })
    registerChat("sub-a", "submitted")

    await wakeQueue("sub-a", fake.client)

    expect(fake.claims).toEqual([])
    expect(sendClaimedQueueItem).not.toHaveBeenCalled()
  })

  it("re-asks after a wake lands while this window's own send is in flight", async () => {
    const first = item("q1", "sub-a", "pending")
    const second = item("q2", "sub-a", "pending")
    const fake = fakeClient({ claimed: [first, second] })
    registerChat("sub-a")

    // Hold the first send open, so the wake the next feed produces arrives
    // while the window's own send still owns the sub-chat.
    let release: () => void = () => {}
    sendClaimedQueueItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve("sent")
        }),
    )

    const sending = wakeQueue("sub-a", fake.client)
    await vi.waitFor(() => expect(sendClaimedQueueItem).toHaveBeenCalledTimes(1))

    // The completion feed for the row in flight: this wake must not claim a
    // second row, and it must not be dropped either.
    applyQueueFeedItem(feed("sub-a", [second]), fake.client)
    expect(fake.claims).toHaveLength(1)

    release()
    await sending
    await vi.waitFor(() => expect(fake.claims).toHaveLength(2), { timeout: 5000 })
    expect(fake.completed).toEqual(["q1", "q2"])
  })

  it("never asks when this window holds no chat for the sub-chat", async () => {
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })

    await wakeQueue("sub-a", fake.client)

    expect(fake.claims).toEqual([])
  })

  it("coalesces a burst of wakes into one question for main", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")

    await Promise.all([wakeQueue("sub-a", fake.client), wakeQueue("sub-a", fake.client)])

    expect(fake.claims).toHaveLength(1)
    expect(fake.completed).toEqual(["q1"])
  })

  it("a window that loses the race sends nothing", async () => {
    // One row, one claim source for both windows: that is what main's claim
    // transaction guarantees, and sharing the source is what makes this a race.
    // With a row each, no window could ever lose one.
    const claimed = [item("q1", "sub-a", "pending")]
    const first = fakeClient({ claimed })
    const second = fakeClient({ claimed })
    registerChat("sub-a")

    await wakeQueue("sub-a", first.client)
    await wakeQueue("sub-a", second.client)

    expect(first.completed).toEqual(["q1"])
    expect(second.completed).toEqual([])
    expect(second.claims).toHaveLength(1)
    expect(sendClaimedQueueItem).toHaveBeenCalledTimes(1)
  })

  it("ends a clear's hold when the feed reconnects with the clear unanswered", async () => {
    vi.useFakeTimers()
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")

    // A clear that never answers holds this sub-chat's sends back, and the rows
    // a feed carries while it is in flight are the ones being deleted.
    fake.queue.clear.mutate.mockImplementation(() => new Promise(() => {}))
    void clearQueueItems("sub-a", fake.client)
    applyQueueFeedItem(feed("sub-a", [claimed]), fake.client)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.queue.claim.mutate).not.toHaveBeenCalled()

    // The connection drops, which reconnects and resets everything this window
    // projected. A hold waiting on an answer that is no longer coming must not
    // survive that: the queue would stay silent for the rest of the session.
    useQueueProjection.getState().resetQueues()
    await wakeQueue("sub-a", fake.client)

    expect(fake.completed).toEqual(["q1"])
  })

  it("forgets the mark a reconnect cannot vouch for, so a later wake sends", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")

    // A clear that landed leaves the mark saying main has none of this
    // sub-chat's rows, which is right until the window reconnects: the replay
    // that follows is what says what main has now.
    await clearQueueItems("sub-a", fake.client)
    useQueueProjection.getState().resetQueues()
    await wakeQueue("sub-a", fake.client)

    expect(fake.completed).toEqual(["q1"])
    expect(fake.requeued).toEqual([])
  })

  it("asks on a feed change, which is the wake a reload produces", async () => {
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })
    registerChat("sub-a")

    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    await vi.waitFor(() =>
      expect(fake.claims).toEqual([{ itemId: undefined, owner: "window-test" }]),
    )
  })

  it("keeps the item queued when the caller cannot clear the sub-chat", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")
    // The callback answers "not clear to send": the turn would not stop, or it
    // belongs to another window.
    sendClaimedQueueItem.mockResolvedValueOnce("failed")

    const sent = await sendQueueItemNow("sub-a", "q1", async () => false, fake.client)

    // The click still ends the pause, but this item goes back to the queue
    // rather than out beside a turn this window could not clear, and the
    // answer says so.
    expect(sent).toBe(false)
    expect(fake.completed).toEqual([])
    expect(fake.requeued).toEqual(["q1"])
    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("error")
  })

  it("Send now claims the item before it resumes the queue", async () => {
    const claimed = item("q1", "sub-a", "paused")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")

    const sent = await sendQueueItemNow("sub-a", "q1", async () => true, fake.client)

    expect(sent).toBe(true)
    expect(fake.paused).toEqual([{ subChatId: "sub-a", paused: false }])
    expect(fake.claims).toEqual([{ itemId: "q1", owner: "window-test" }])
    expect(fake.completed).toEqual(["q1"])
    // Resuming first would let the feed's wake claim another row for this
    // window, so the send would go out beside the item the user picked.
    // The item is claimed and its bookkeeping finishes before the resume, so
    // the wake the resume causes cannot claim another row for this window.
    expect(fake.calls).toEqual(["claim:q1", "complete:q1", "setPaused:false"])
  })

  it("retries the bookkeeping once when the first call fails", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")
    fake.queue.complete.mutate.mockRejectedValueOnce(new Error("db is busy"))

    await wakeQueue("sub-a", fake.client)

    // A send that went out must not stay hidden as `sending` because one
    // bookkeeping call failed on the way home.
    expect(fake.completed).toEqual(["q1"])
    expect(sendClaimedQueueItem).toHaveBeenCalledTimes(1)
  })

  it("stops after the second failed bookkeeping call", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")
    fake.queue.complete.mutate.mockRejectedValue(new Error("db is busy"))

    await wakeQueue("sub-a", fake.client)

    // Nothing recorded, and no third call: main still holds the row and settles
    // it on the next wake of this sub-chat, or at startup recovery.
    expect(fake.completed).toEqual([])
    expect(fake.queue.complete.mutate).toHaveBeenCalledTimes(2)
  })

  it("does not spend a retry on wakes that arrive while one is pending", async () => {
    vi.useFakeTimers()
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })

    // A queue draining in another window emits several feed updates before the
    // pane that owns the chat is up. Each one is a wake with no pane to send
    // with, and none of them may spend the budget the pane's own retries need.
    for (let i = 0; i < 6; i += 1) {
      applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    }
    expect(fake.claims).toEqual([])

    // The pane arrives inside the window, and the retry still runs: it is the
    // pane's retry, not the feed updates'.
    await vi.advanceTimersByTimeAsync(2_000)
    registerChat("sub-a")
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(0)

    expect(fake.claims).toHaveLength(1)
    expect(fake.completed).toEqual(["q1"])
  })

  it("hands the row back when a turn goes live while the claim is in flight", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    const chat = registerChat("sub-a")

    // The claim answer is one round trip old, and a turn can go live inside it:
    // the question asked before the claim cannot answer for after it.
    fake.queue.claim.mutate.mockImplementationOnce(async () => {
      useStreamingStatusStore.getState().setStatus("sub-a", "streaming")
      return claimed
    })
    await wakeQueue("sub-a", fake.client)

    // Sending now would run a second turn on the same session, so the row goes
    // back to the queue instead; the turn's own end is the next wake.
    expect(chat.sendMessage).not.toHaveBeenCalled()
    expect(fake.requeued).toEqual(["q1"])
  })

  it("does not claim for a sub-chat while its clear is in flight", async () => {
    vi.useFakeTimers()
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")

    // The user asks to drop the queue, and main has not answered yet: its rows
    // are still there and a claim can still be handed one.
    let finish: () => void = () => {}
    fake.queue.clear.mutate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(1)
        }),
    )
    const clearing = clearQueueItems("sub-a", fake.client)

    // A feed reading taken before the clear landed carries those rows. Acting
    // on it would send a message the user just asked to delete, and handing it
    // back would only make the feed speak again, so the claim is held.
    applyQueueFeedItem(feed("sub-a", [claimed]), fake.client)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.queue.claim.mutate).not.toHaveBeenCalled()

    finish()
    await clearing
  })

  it("hands an in-flight claim back when a stale reading arrives during the clear", async () => {
    vi.useFakeTimers()
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    const chat = registerChat("sub-a")

    // A wake claims the row and is about to send it, and the user deletes the
    // queue in the same breath: the row is handed over before the delete lands.
    applyQueueFeedItem(feed("sub-a", [claimed]), fake.client)
    let finish: () => void = () => {}
    fake.queue.clear.mutate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(1)
        }),
    )
    const clearing = clearQueueItems("sub-a", fake.client)
    // A reading taken before the delete landed carries the row again. If it
    // clears the mark that says main has none, the claim in flight sends a
    // message the user just asked to delete.
    applyQueueFeedItem(feed("sub-a", [claimed]), fake.client)

    await vi.advanceTimersByTimeAsync(0)
    expect(chat.sendMessage).not.toHaveBeenCalled()
    expect(fake.requeued).toEqual(["q1"])

    finish()
    await clearing
  })

  it("asks once the delete has an answer, so a row added during it is not stranded", async () => {
    vi.useFakeTimers()
    const arrived = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [arrived] })
    registerChat("sub-a")

    let finish: () => void = () => {}
    fake.queue.clear.mutate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(1)
        }),
    )
    const clearing = clearQueueItems("sub-a", fake.client)

    // A row that arrived while the delete was in flight is held, because the
    // reading is older than the delete. The answer to the delete is the event
    // that ends the hold, and it is the only one: nothing else may come.
    applyQueueFeedItem(feed("sub-a", [arrived]), fake.client)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.queue.claim.mutate).not.toHaveBeenCalled()

    finish()
    await clearing
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.claims).toHaveLength(1)
  })

  it("ends the hold only when the last of two overlapping clears answers", async () => {
    vi.useFakeTimers()
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")

    // Two clears can overlap (a double click on the same control), so one answer
    // is not the end of the hold: the rows are still the ones the user asked to
    // drop, and the second clear has not run yet.
    const answers: Array<() => void> = []
    fake.queue.clear.mutate.mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(() => resolve(1))
        }),
    )
    const first = clearQueueItems("sub-a", fake.client)
    const second = clearQueueItems("sub-a", fake.client)

    answers[0]()
    await first
    applyQueueFeedItem(feed("sub-a", [claimed]), fake.client)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.queue.claim.mutate).not.toHaveBeenCalled()

    answers[1]()
    await second
    await vi.advanceTimersByTimeAsync(0)
    // The last answer is the event that lets this window ask again.
    expect(fake.claims).toHaveLength(1)
  })

  it("asks again when a pane that can send appears, after the retries ran out", async () => {
    vi.useFakeTimers()
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })
    const stop = startQueueSync(fake.client)

    // The feed replays before the pane exists, so the first wake has nothing to
    // send with, and its bounded re-ask runs out.
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.claims).toEqual([])

    // The pane appears later. Its sub-chat is already `ready`, so no status
    // write is coming to wake the queue: without the registration wake the rows
    // wait for something else to happen in that sub-chat.
    registerChat("sub-a")
    await vi.advanceTimersByTimeAsync(0)

    expect(fake.claims).toHaveLength(1)
    stop()
  })

  it("puts the card back when the clear does not land", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    // A turn is running, so the row stays `pending`: this is the queue the user
    // tried to delete, not one a send already retired.
    registerChat("sub-a", "streaming")
    fake.queue.clear.mutate.mockRejectedValueOnce(new Error("db is busy"))
    applyQueueFeedItem(feed("sub-a", [claimed]), fake.client)
    expect(fake.completed).toEqual([])

    await clearQueueItems("sub-a", fake.client)

    // Main still has the row, so the window must still show the queue it holds:
    // an empty card would be a queue the user believes is gone.
    expect(useQueueProjection.getState().queues["sub-a"]?.map((row) => row.id)).toEqual(["q1"])
    expect(hasQueuedMessages("sub-a")).toBe(true)
    // The wake found no sender and left a bounded retry pending; it belongs to
    // this test, so it goes now instead of firing inside the next one.
    cancelPendingWakeRetries()
  })

  it("keeps what the feed says after a clear that does not land", async () => {
    const fake = fakeClient()
    fake.queue.clear.mutate.mockRejectedValueOnce(new Error("db is busy"))
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)

    const clearing = clearQueueItems("sub-a", fake.client)
    // While main is being asked, another window's change lands: this reading is
    // newer than the snapshot the clear is holding.
    applyQueueFeedItem(feed("sub-a", [item("q2", "sub-a", "pending")]), fake.client)
    await clearing

    // The failure changed nothing in main, so the card keeps the newest row
    // rather than the one that was there when the clear started.
    expect(useQueueProjection.getState().queues["sub-a"]?.map((row) => row.id)).toEqual(["q2"])
    expect(hasQueuedMessages("sub-a")).toBe(true)
    cancelPendingWakeRetries()
  })

  it("stops re-asking a pane that never showed up, instead of polling for it", async () => {
    vi.useFakeTimers()
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })

    // A reload can replay rows before the pane that owns the chat exists, so
    // the first wake has nothing to send with.
    applyQueueFeedItem(feed("sub-a", [item("q1", "sub-a", "pending")]), fake.client)
    expect(fake.claims).toEqual([])

    // The pane never appears. The retries have to run out: a count that is
    // dropped as each timer fires restarts the sequence every time, which is a
    // two-second poll for the life of the window instead of a bound.
    await vi.advanceTimersByTimeAsync(60_000)

    expect(vi.getTimerCount()).toBe(0)
  })

  it("cancels a pending retry when the sync stops", async () => {
    vi.useFakeTimers()
    const fake = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })
    const stop = startQueueSync(fake.client)

    fake.pushFeed(feed("sub-a", [item("q1", "sub-a", "pending")]))
    expect(fake.claims).toEqual([])

    // The pane arrives while the sync is alive, and that arrival is a wake of
    // its own: a pane whose sub-chat is already ready writes no status, so
    // nothing else would ask for the row.
    registerChat("sub-a")
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.claims).toHaveLength(1)

    stop()

    // A retry that outlived the sync would ask again for a window that stopped
    // syncing, so the pending timer has to be gone.
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fake.claims).toHaveLength(1)
  })

  it("hands the row back when Send now races the sub-chat's deletion", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")
    // The queue was dropped on its way to the click, and the clear may not have
    // reached main: a claim nobody will send has to go back, or it sits hidden
    // as `sending` with no window to finish it.
    await clearQueueItems("sub-a", fake.client)

    const sent = await sendQueueItemNow("sub-a", "q1", async () => true, fake.client)

    expect(sent).toBe(false)
    expect(fake.requeued).toEqual(["q1"])
    expect(sendClaimedQueueItem).not.toHaveBeenCalled()
  })

  it("forgets a clear that failed, so the rows main still has can be sent", async () => {
    const claimed = item("q1", "sub-a", "pending")
    const fake = fakeClient({ claimed: [claimed] })
    registerChat("sub-a")
    fake.queue.clear.mutate.mockRejectedValueOnce(new Error("db is busy"))

    await clearQueueItems("sub-a", fake.client)
    await wakeQueue("sub-a", fake.client)

    // The clear never landed, so main still has the row. Keeping the mark that
    // says it has none would make every later wake hand the claim straight back.
    expect(fake.claims).toHaveLength(1)
    expect(fake.completed).toEqual(["q1"])
  })
})
