/**
 * Queue send tests (roadmap step 08). This path owns the rule that keeps a
 * message from going out twice: the hand-off is recorded in main before the
 * payload leaves, and what came back is what the caller may record. The
 * stores and the parts builder around it are mocked; the ordering and the
 * outcome vocabulary are the subject.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
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
  agentChatStore: { getParentChatId: () => undefined },
}))
vi.mock("../stores/sub-chat-store", () => ({
  useAgentSubChatStore: {
    getState: () => ({ allSubChats: [], updateSubChatTimestamp: () => {} }),
  },
}))
vi.mock("../stores/streaming-status-store", () => ({
  waitForTurnStart: held.waitForTurnStart,
}))

import { sendClaimedQueueItem } from "./queue-send"

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
    vi.useRealTimers()
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
  })

  it("parks the outcome when the send rejects after the hand-off", async () => {
    held.sendMessage.mockRejectedValue(new Error("engine down"))

    const result = await sendClaimedQueueItem(input())

    expect(result).toBe("uncertain")
    expect(held.toastError).toHaveBeenCalled()
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
