"use client"

/**
 * Sends one claimed queue item through the chat the renderer owns, so the
 * prompt and the per-chat settings stay exactly what a direct send uses
 * (roadmap step 08). One implementation for the automatic dispatch and for
 * Send now; the caller only differs by passing a `stopCurrent`.
 */
import type { Chat } from "@ai-sdk/react"
import type { UIMessage } from "ai"
import { toast } from "sonner"
import type { QueueItem } from "../../../../shared/queue-item"
import { trackMessageSent } from "../../../lib/analytics"
import { appStore } from "../../../lib/jotai-store"
import { clearLoading, loadingSubChatsAtom, setLoading } from "../atoms"
import { agentChatStore } from "../stores/agent-chat-store"
import { waitForStreamingReady, waitForTurnStart } from "../stores/streaming-status-store"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { buildQueueMessageParts } from "./queue-parts"

/** The first chunk shape a turn produces, which is what scrolls the pane. */
type QueueSentListener = (subChatId: string) => void

const sentListeners = new Set<QueueSentListener>()

/** Signal that a queued message left for the engine, so the pane can scroll. */
export function subscribeQueueSent(listener: QueueSentListener): () => void {
  sentListeners.add(listener)
  return () => sentListeners.delete(listener)
}

function emitQueueSent(subChatId: string): void {
  for (const listener of sentListeners) {
    listener(subChatId)
  }
}

function markQueueSendStarted(subChatId: string): void {
  const parentChatId = agentChatStore.getParentChatId(subChatId)
  if (!parentChatId) return
  setLoading(
    (fn) => appStore.set(loadingSubChatsAtom, fn(appStore.get(loadingSubChatsAtom))),
    subChatId,
    parentChatId,
  )
}

function clearQueueSendStarted(subChatId: string): void {
  clearLoading(
    (fn) => appStore.set(loadingSubChatsAtom, fn(appStore.get(loadingSubChatsAtom))),
    subChatId,
  )
}

export type QueueSendResult = "sent" | "failed"

export interface QueueSendInput {
  item: QueueItem
  chat: Chat<UIMessage>
  /** Send now only: stop the turn in flight and wait for it to settle. */
  stopCurrent?: () => Promise<void>
}

/**
 * Sends a claimed item and reports whether the message left. The item is
 * retired by the caller on `sent`, which happens as soon as the turn reports
 * that it started, so a window that dies mid-turn cannot resend a message that
 * already went out. A failure before the turn starts is reported as `failed`
 * and the caller puts the item back.
 */
export async function sendClaimedQueueItem({
  item,
  chat,
  stopCurrent,
}: QueueSendInput): Promise<QueueSendResult> {
  const subChatId = item.subChatId
  try {
    if (stopCurrent) {
      await stopCurrent()
      // If the turn in flight does not report itself done in time, keep this
      // item in the queue instead of starting a second turn beside it.
      if (!(await waitForStreamingReady(subChatId))) {
        return "failed"
      }
    }

    const parts = buildQueueMessageParts(item.payload)
    const subChatMeta = useAgentSubChatStore
      .getState()
      .allSubChats.find((candidate) => candidate.id === subChatId)
    trackMessageSent({
      workspaceId: subChatId,
      messageLength: item.payload.message.length,
      mode: subChatMeta?.mode || "agent",
    })
    useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)
    markQueueSendStarted(subChatId)
    emitQueueSent(subChatId)

    const sending = chat.sendMessage({ role: "user", parts })
    let sendFailure: unknown = null
    const finished = sending.then(
      () => undefined,
      (error: unknown) => {
        sendFailure = error
      },
    )
    const turnStart = waitForTurnStart(subChatId)
    let firstEvent: "started" | "settled"
    try {
      firstEvent = await Promise.race([
        turnStart.promise.then(() => "started" as const),
        finished.then(() => "settled" as const),
      ])
    } finally {
      // Whichever side lost the race must not keep a listener on the store.
      turnStart.cancel()
    }

    if (firstEvent === "started") {
      // The message is out. The rest of the turn is the turn's business, so a
      // mid-turn failure is logged and never resends what already went out.
      void finished.then(() => {
        if (sendFailure) {
          console.error("[queue] turn failed after a queued send:", sendFailure)
        }
      })
      return "sent"
    }

    await finished
    if (sendFailure) {
      console.error("[queue] queued send failed before the turn started:", sendFailure)
      clearQueueSendStarted(subChatId)
      toast.error("Failed to send the queued message. It is still in the queue.")
      return "failed"
    }
    return "sent"
  } catch (error) {
    console.error("[queue] queued send threw:", error)
    clearQueueSendStarted(subChatId)
    toast.error("Failed to send the queued message. It is still in the queue.")
    return "failed"
  }
}
