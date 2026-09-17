/**
 * Queue projection tests (roadmap step 08). Drives the projection with a fake
 * tRPC client and a fake chat, and asserts the rules that make two windows
 * safe: main decides who gets an item, a window that cannot send never asks,
 * and a failed send is handed back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "../../../../shared/queue-item"

const sendClaimedQueueItem = vi.hoisted(() => vi.fn())
vi.mock("../lib/queue-send", () => ({ sendClaimedQueueItem }))

import type { QueueFeedItem } from "../../../../main/lib/trpc/routers/queue"
import { agentChatStore } from "./agent-chat-store"
import {
  applyQueueFeedItem,
  clearQueueItems,
  hasQueuedMessages,
  type QueueFeedClient,
  sendQueueItemNow,
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
  const handed: string[] = []
  const paused: Array<{ subChatId: string; paused: boolean }> = []
  /** Every claim/hand-off/complete/resume in the order they reached main. */
  const calls: string[] = []
  let handOffAllowed = options.handed ?? true
  const queue = {
    claimed: options.claimed ?? [],
    subscribe: {
      subscribe: (_input: unknown, _handlers: unknown) => ({ unsubscribe: () => {} }),
    },
    add: { mutate: vi.fn() },
    remove: { mutate: vi.fn() },
    clear: { mutate: vi.fn() },
    claim: {
      mutate: async (input: { subChatId: string; itemId?: string; owner: string }) => {
        claims.push({ itemId: input.itemId, owner: input.owner })
        calls.push(`claim:${input.itemId ?? "head"}`)
        return queue.claimed.shift() ?? null
      },
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
      mutate: async (input: { subChatId: string; itemId: string }) => {
        parked.push(input.itemId)
        calls.push(`park:${input.itemId}`)
        return true
      },
    },
    complete: {
      mutate: async (input: { subChatId: string; itemId: string }) => {
        completed.push(input.itemId)
        calls.push(`complete:${input.itemId}`)
        return true
      },
    },
    requeue: {
      mutate: async (input: { subChatId: string; itemId: string }) => {
        requeued.push(input.itemId)
        calls.push(`requeue:${input.itemId}`)
        return true
      },
    },
    setPaused: {
      mutate: async (input: { subChatId: string; paused: boolean }) => {
        paused.push(input)
        calls.push(`setPaused:${input.paused}`)
        return 0
      },
    },
  }
  return {
    client: { owner: "window-test", queue } as unknown as QueueFeedClient,
    claims,
    completed,
    requeued,
    parked,
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

describe("queue projection", () => {
  beforeEach(() => {
    useQueueProjection.setState({ queues: {} })
    useStreamingStatusStore.setState({ statuses: {} })
    agentChatStore.clear()
    sendClaimedQueueItem.mockReset()
    sendClaimedQueueItem.mockResolvedValue("sent")
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
    // The second window asks after main already handed the item to the first,
    // which is what the claim transaction guarantees: one winner, one send.
    const first = fakeClient({ claimed: [item("q1", "sub-a", "pending")] })
    const second = fakeClient({ claimed: [] })
    registerChat("sub-a")

    await wakeQueue("sub-a", first.client)
    await wakeQueue("sub-a", second.client)

    expect(first.completed).toEqual(["q1"])
    expect(second.completed).toEqual([])
    expect(sendClaimedQueueItem).toHaveBeenCalledTimes(1)
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

    await sendQueueItemNow("sub-a", "q1", async () => false, fake.client)

    // The click still ends the pause, but this item goes back to the queue
    // rather than out beside a turn this window could not clear.
    expect(fake.completed).toEqual([])
    expect(fake.requeued).toEqual(["q1"])
    expect(useStreamingStatusStore.getState().getStatus("sub-a")).toBe("error")
  })

  it("Send now resumes the queue before claiming that item", async () => {
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
})
