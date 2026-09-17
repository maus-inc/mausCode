/**
 * Queue send tests (roadmap step 08). This path owns the rule that keeps a
 * message from going out twice: the hand-off is recorded in main before the
 * payload leaves, and what came back is what the caller may record. The
 * stores and the parts builder around it are mocked; the ordering and the
 * outcome vocabulary are the subject.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "../../../../shared/queue-item"

const held = vi.hoisted(() => ({
  order: [] as string[],
  markHanded: vi.fn(),
  sendMessage: vi.fn(),
  waitForTurnStart: vi.fn(),
  cancel: vi.fn(),
  toastError: vi.fn(),
  clearLoading: vi.fn(),
  setLoading: vi.fn(),
  getParentChatId: vi.fn((): string | undefined => undefined),
  isStreaming: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { error: held.toastError } }))
vi.mock("./queue-parts", () => ({ buildQueueMessageParts: () => [{ type: "text", text: "one" }] }))
vi.mock("../../../lib/analytics", () => ({ trackMessageSent: () => {} }))
vi.mock("../../../lib/jotai-store", () => ({ appStore: { get: () => ({}), set: () => {} } }))
vi.mock("../atoms", () => ({
  clearLoading: held.clearLoading,
  setLoading: held.setLoading,
  loadingSubChatsAtom: {},
}))
vi.mock("../stores/agent-chat-store", () => ({
  agentChatStore: { getParentChatId: held.getParentChatId },
}))
vi.mock("../stores/sub-chat-store", () => ({
  useAgentSubChatStore: {
    getState: () => ({ allSubChats: [], updateSubChatTimestamp: () => {} }),
  },
}))
vi.mock("../stores/streaming-status-store", () => ({
  waitForTurnStart: held.waitForTurnStart,
  useStreamingStatusStore: { getState: () => ({ isStreaming: held.isStreaming }) },
}))

import { sendClaimedQueueItem, subscribeQueueSent } from "./queue-send"

function item(): QueueItem {
  return {
    id: "q1",
    subChatId: "sub-a",
    position: 1024,
    status: "sending",
    payload: { message: "one" },
    createdAt: new Date(),
    dispatchedAt: new Date(),
  }
}

describe("queue send", () => {
  beforeEach(() => {
    held.order.length = 0
    held.markHanded.mockReset()
    held.sendMessage.mockReset()
    held.waitForTurnStart.mockReset()
    held.cancel.mockReset()
    held.toastError.mockReset()
    held.clearLoading.mockReset()
    held.setLoading.mockReset()
    held.getParentChatId.mockReset()
    held.getParentChatId.mockReturnValue(undefined)
    held.isStreaming.mockReset()
    // Nothing live by default: the store is what the sender asks before it
    // hands the payload over.
    held.isStreaming.mockReturnValue(false)
    held.markHanded.mockImplementation(async () => {
      held.order.push("handed")
      return true
    })
    held.sendMessage.mockImplementation(() => {
      held.order.push("send")
      return Promise.resolve()
    })
    // By default no turn reports itself, which is the case the reviewers asked
    // about: the send call resolved and no status arrived.
    held.waitForTurnStart.mockReturnValue({
      promise: new Promise<void>(() => {}),
      expired: new Promise<void>(() => {}),
      cancel: held.cancel,
    })
  })

  // The park test runs on fake timers; a failure inside it must not leave them
  // on for every test after it.
  afterEach(() => {
    vi.useRealTimers()
  })

  function input(overrides: Record<string, unknown> = {}) {
    return {
      item: item(),
      chat: { sendMessage: held.sendMessage } as never,
      markHanded: held.markHanded,
      ...overrides,
    }
  }

  it("records the hand-off before the payload leaves and retires the row", async () => {
    const result = await sendClaimedQueueItem(input())

    expect(result).toBe("sent")
    expect(held.order).toEqual(["handed", "send"])
    // The losing side of the race drops its listener.
    expect(held.cancel).toHaveBeenCalled()
    // A resolved send with no status is still retired: the engine consumed the
    // response for the message it accepted, and resending is the only way to
    // duplicate it.
    expect(held.toastError).not.toHaveBeenCalled()
    // No turn reported itself, so nothing else clears the loading mark this
    // send set; leaving it would show the sub-chat as loading for good.
    expect(held.clearLoading).toHaveBeenCalledWith(expect.any(Function), "sub-a")
  })

  it("parks the hand-off when the send call never settles after the wait", async () => {
    vi.useFakeTimers()
    // No turn reported itself inside the wait, and the transport then never
    // answers either: the row may not stay `sending` for the life of the window.
    held.waitForTurnStart.mockReturnValue({
      promise: new Promise<void>(() => {}),
      expired: Promise.resolve(),
      cancel: held.cancel,
    })
    held.sendMessage.mockImplementation(() => {
      held.order.push("send")
      return new Promise<void>(() => {})
    })

    const sending = sendClaimedQueueItem(input())
    // Let the sender reach the wait on the send call, then take the wait past
    // its grace.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const result = await sending

    expect(result).toBe("uncertain")
    expect(held.toastError).toHaveBeenCalled()
    expect(held.clearLoading).toHaveBeenCalledWith(expect.any(Function), "sub-a")
  })

  it("keeps the item queued when a turn is already live for the sub-chat", async () => {
    held.isStreaming.mockReturnValue(true)

    const result = await sendClaimedQueueItem(input())

    // Sending beside a live turn would run two turns on one session, and the
    // live turn's start would stand in for this message's, so the row stays
    // queued instead.
    expect(result).toBe("failed")
    expect(held.markHanded).not.toHaveBeenCalled()
    expect(held.sendMessage).not.toHaveBeenCalled()
    expect(held.toastError).toHaveBeenCalled()
  })

  it("sends nothing when the claim moved on", async () => {
    held.markHanded.mockResolvedValue(false)

    const result = await sendClaimedQueueItem(input())

    expect(result).toBe("cancelled")
    expect(held.sendMessage).not.toHaveBeenCalled()
    expect(held.toastError).not.toHaveBeenCalled()
  })

  it("hands the item back when the turn in flight cannot be cleared", async () => {
    const result = await sendClaimedQueueItem(input({ stopCurrent: async () => false }))

    expect(result).toBe("failed")
    expect(held.markHanded).not.toHaveBeenCalled()
    expect(held.sendMessage).not.toHaveBeenCalled()
    // The user clicked Send now and nothing was sent, so the outcome has to be
    // visible: the row is still in the queue and they need to know that.
    expect(held.toastError).toHaveBeenCalled()
  })

  it("parks the outcome when the send throws after the hand-off", async () => {
    // A transport that throws on the way in is the same situation as one that
    // rejects: the hand-off is already recorded, so the payload may be with the
    // engine. Answering "failed" here would put the row back and send it again.
    held.sendMessage.mockImplementation(() => {
      throw new Error("transport refused")
    })

    const result = await sendClaimedQueueItem(input())

    expect(result).toBe("uncertain")
    expect(held.toastError).toHaveBeenCalled()
    expect(held.clearLoading).toHaveBeenCalledWith(expect.any(Function), "sub-a")
  })

  it("marks the sub-chat loading before the payload leaves, for the sidebar", async () => {
    held.getParentChatId.mockReturnValue("parent-1")

    await sendClaimedQueueItem(input())

    expect(held.setLoading).toHaveBeenCalledWith(expect.any(Function), "sub-a", "parent-1")
  })

  it("parks the outcome when the send rejects after the hand-off", async () => {
    held.sendMessage.mockRejectedValue(new Error("engine down"))

    const result = await sendClaimedQueueItem(input())

    expect(result).toBe("uncertain")
    expect(held.toastError).toHaveBeenCalled()
  })

  it("signals the pane to scroll when the payload leaves, and only then", async () => {
    const sent: string[] = []
    const unsubscribe = subscribeQueueSent((subChatId) => sent.push(subChatId))
    try {
      // A claim that moved on sends nothing, so the pane has nothing to scroll
      // to; a listener told otherwise would jump the view for no message.
      held.markHanded.mockResolvedValue(false)
      await sendClaimedQueueItem(input())
      expect(sent).toEqual([])

      held.markHanded.mockImplementation(async () => {
        held.order.push("handed")
        return true
      })
      await sendClaimedQueueItem(input())
      expect(sent).toEqual(["sub-a"])
    } finally {
      unsubscribe()
    }
  })

  it("drops the scroll listener when the pane unmounts", async () => {
    const sent: string[] = []
    const unsubscribe = subscribeQueueSent((subChatId) => sent.push(subChatId))
    unsubscribe()

    await sendClaimedQueueItem(input())

    expect(sent).toEqual([])
  })

  it("retires the row when the turn started, even if the turn then fails", async () => {
    held.waitForTurnStart.mockReturnValue({
      promise: Promise.resolve(),
      expired: new Promise<void>(() => {}),
      cancel: held.cancel,
    })
    held.sendMessage.mockImplementation(() => {
      held.order.push("send")
      return Promise.reject(new Error("turn failed mid-stream"))
    })

    const result = await sendClaimedQueueItem(input())

    expect(result).toBe("sent")
  })
})
