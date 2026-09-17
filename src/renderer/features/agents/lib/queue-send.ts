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
import { useStreamingStatusStore, waitForTurnStart } from "../stores/streaming-status-store"
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

/**
 * How long the sender waits on the send call itself after no turn reported
 * itself. Long enough for a slow engine to answer, short enough that a
 * transport that never settles cannot keep the row `sending` — hidden from the
 * queue and blocking everything behind it — for the life of the window.
 */
const SEND_SETTLE_GRACE_MS = 5 * 60_000

/** Wait for a settled promise, or give up on it after `ms`. */
function settlesWithin(settled: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => resolve(false), ms)
    // The renderer has no `unref`; node does, and the tests run this module
    // there, so a wait that is abandoned must not keep the process alive.
    ;(timer as unknown as { unref?: () => void }).unref?.()
    void settled.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/**
 * The row was handed over and the outcome is unknown, so it is parked: visible,
 * out of the automatic path, and never sent again on its own.
 */
function unconfirmed(subChatId: string): QueueSendResult {
  clearQueueSendStarted(subChatId)
  toast.error("The queued message may not have gone out. It is paused in the queue.")
  return "uncertain"
}

export type QueueSendResult = "sent" | "failed" | "uncertain" | "cancelled"

export interface QueueSendInput {
  item: QueueItem
  chat: Chat<UIMessage>
  /**
   * Records the hand-off in main, immediately before the payload leaves. A
   * `false` answer means the claim is no longer this window's (the queue was
   * cleared, or another window took it over), so nothing may be sent under it.
   */
  markHanded: () => Promise<boolean>
  /**
   * Send now only: stop whatever turn is in flight for this sub-chat and
   * answer whether the send may proceed. `false` keeps the item queued, which
   * is the answer when the turn in flight belongs to another window and this
   * one must not send beside it.
   */
  stopCurrent?: () => Promise<boolean>
}

/**
 * Sends a claimed item and reports what is known about it.
 *
 * `"sent"` — the turn reported itself, or the send call resolved, which means
 * the engine consumed the response to a message it had already accepted. The
 * caller retires the row.
 *
 * `"failed"` — nothing was handed over (the turn in flight could not be
 * cleared, or the payload could not be built), so the caller puts the item
 * back in the queue.
 *
 * `"uncertain"` — the payload was handed over and the send call then rejected,
 * so the message may or may not have reached the engine. The caller parks the
 * row: visible, out of the automatic path, never resent on its own.
 *
 * `"cancelled"` — the claim was refused (the queue was cleared, or another
 * window took the row over), so nothing was sent and no row is this caller's
 * to record.
 */
export async function sendClaimedQueueItem({
  item,
  chat,
  markHanded,
  stopCurrent,
}: QueueSendInput): Promise<QueueSendResult> {
  const subChatId = item.subChatId
  let handed = false
  try {
    if (stopCurrent && !(await stopCurrent())) {
      // The caller could not clear the sub-chat (a turn that did not stop in
      // time, or one that belongs to another window), so the item stays queued
      // instead of running a second turn beside it. Nothing was handed over.
      // Say so: every other outcome here tells the user what happened, and this
      // one is reached by a click that would otherwise look like it did nothing.
      toast.error("Could not send that queued message now. It is still in the queue.")
      return "failed"
    }

    // A turn already live for this sub-chat is not this message's: the status
    // store is keyed by sub-chat, so nothing here can tell one turn's start
    // from another's, and sending beside it would both run two turns on one
    // session and let that other turn stand in for this message. After a stop
    // above, a live status can only be a turn that started since.
    if (useStreamingStatusStore.getState().isStreaming(subChatId)) {
      toast.error("Could not send that queued message now. It is still in the queue.")
      return "failed"
    }

    const parts = buildQueueMessageParts(item.payload)
    handed = await markHanded()
    if (!handed) {
      console.warn("[queue] the claim moved on before the send; nothing was sent")
      return "cancelled"
    }

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
    let firstEvent: "started" | "settled" | "expired"
    try {
      firstEvent = await Promise.race([
        turnStart.promise.then(() => "started" as const),
        finished.then(() => "settled" as const),
        turnStart.expired.then(() => "expired" as const),
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

    if (firstEvent === "expired") {
      // No status arrived inside the wait. The send call is still the only
      // thing that can report what happened, so its result is what is recorded;
      // the row is never sent again either way. It does not get to hold the row
      // forever though: a call that never settles would leave the row `sending`
      // and the queue behind it stalled, so past the grace the hand-off is
      // parked like any other one whose fate is unknown.
      console.error("[queue] no turn reported itself for the queued send")
      if (!(await settlesWithin(finished, SEND_SETTLE_GRACE_MS))) {
        console.error("[queue] the queued send never settled; parking it as unconfirmed")
        return unconfirmed(subChatId)
      }
    }
    await finished
    if (sendFailure) {
      console.error("[queue] queued send failed after the hand-off:", sendFailure)
      return unconfirmed(subChatId)
    }
    // The send call resolved without our status store ever seeing a turn. The
    // engine consumed the response for the message it accepted, so the row is
    // retired; retrying it is the one thing that could duplicate it.
    console.warn("[queue] send resolved without a turn start on this window")
    // No turn reported itself, so nothing else will clear the mark this send
    // set; without this the sub-chat shows as loading for good.
    clearQueueSendStarted(subChatId)
    return "sent"
  } catch (error) {
    console.error("[queue] queued send threw:", error)
    if (handed) return unconfirmed(subChatId)
    clearQueueSendStarted(subChatId)
    toast.error("Failed to send the queued message. It is still in the queue.")
    return "failed"
  }
}
