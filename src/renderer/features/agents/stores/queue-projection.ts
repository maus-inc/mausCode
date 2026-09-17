"use client"

/**
 * Queue projection (roadmap step 08). Opens one `queue.subscribe` per window,
 * keeps the main-owned rows in a store, and asks main for the next item when
 * this window can send one. Main owns the rows, the order and the hand-off;
 * this module owns the wake rules and the local cache. Design contract:
 * `.dump/app/plans/2026-09-17-queue-in-main.md`.
 */
import type { Chat } from "@ai-sdk/react"
import type { UIMessage } from "ai"
import { toast } from "sonner"
import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"
import type { QueueFeedItem } from "../../../../main/lib/trpc/routers/queue"
import {
  type QueueItem,
  type QueueItemView,
  type QueuePayload,
  toQueueItemView,
} from "../../../../shared/queue-item"
import { getWindowId } from "../../../contexts/WindowContext"
import { trpcClient } from "../../../lib/trpc"
import { type QueueSendResult, sendClaimedQueueItem } from "../lib/queue-send"
import { agentChatStore } from "./agent-chat-store"
import { useStreamingStatusStore } from "./streaming-status-store"

/** Stable empty list, so an empty queue does not re-render its card. */
export const EMPTY_PROJECTED_QUEUE: QueueItemView[] = []

/**
 * What the memory guards ask before they evict a chat instance. A row being
 * sent counts: its send still needs the chat's runtime, and the hand-off is
 * exactly when evicting it would break the queue.
 */
export function hasQueuedMessages(subChatId: string): boolean {
  const state = useQueueProjection.getState()
  if ((state.queues[subChatId]?.length ?? 0) > 0) return true
  return (state.hiddenCounts[subChatId] ?? 0) > 0
}

const FEED_RETRY_DELAY_MS = 2000

interface QueueProjectionState {
  /** Card items per sub-chat: the rows the indicator shows, in order. */
  queues: Record<string, QueueItemView[]>
  /**
   * Rows main has but the card must not show (`sending`). They still count as
   * queued work, for the guards that decide whether a chat may be evicted.
   */
  hiddenCounts: Record<string, number>
  setQueue: (subChatId: string, items: QueueItemView[], hiddenCount: number) => void
  dropQueue: (subChatId: string) => void
  /** Forget every card, for a reconnect that replays main's state. */
  resetQueues: () => void
}

export const useQueueProjection = create<QueueProjectionState>()(
  subscribeWithSelector((set) => ({
    queues: {},
    hiddenCounts: {},
    setQueue: (subChatId, items, hiddenCount) => {
      // A feed that carries a row means the sub-chat has a queue again. An
      // empty feed must not clear the mark: the clear the mark was set for
      // produces one, and a claim still in flight would arrive after it.
      if (items.length > 0) unknownSubChatIds.delete(subChatId)
      set((state) => {
        const current = state.queues[subChatId]
        const sameHidden = (state.hiddenCounts[subChatId] ?? 0) === hiddenCount
        if (
          current &&
          sameHidden &&
          current.length === items.length &&
          current.every(
            (item, index) => item.id === items[index].id && item.status === items[index].status,
          )
        ) {
          return state
        }
        return {
          queues: { ...state.queues, [subChatId]: items },
          hiddenCounts: { ...state.hiddenCounts, [subChatId]: hiddenCount },
        }
      })
    },
    dropQueue: (subChatId) => {
      set((state) => {
        if (!(subChatId in state.queues) && !(subChatId in state.hiddenCounts)) return state
        const queues = { ...state.queues }
        delete queues[subChatId]
        const hiddenCounts = { ...state.hiddenCounts }
        delete hiddenCounts[subChatId]
        return { queues, hiddenCounts }
      })
    },
    resetQueues: () => {
      set((state) =>
        Object.keys(state.queues).length === 0 && Object.keys(state.hiddenCounts).length === 0
          ? state
          : { queues: {}, hiddenCounts: {} },
      )
    },
  })),
)

export type QueueFeedClient = {
  /**
   * The window asking for work, from the same source as its storage
   * namespacing. Optional so the real client can stay a plain tRPC proxy; a
   * test client names itself instead of touching the DOM.
   */
  owner?: string
  queue: {
    subscribe: {
      subscribe: (
        input: { subChatId?: string } | undefined,
        handlers: {
          onData: (item: QueueFeedItem) => void
          onError?: (error: Error) => void
        },
      ) => { unsubscribe: () => void }
    }
    add: {
      mutate: (input: { subChatId: string; payload: QueuePayload }) => Promise<QueueItem>
    }
    remove: {
      mutate: (input: { subChatId: string; itemId: string }) => Promise<boolean>
    }
    clear: {
      mutate: (input: { subChatId: string }) => Promise<number>
    }
    claim: {
      mutate: (input: {
        subChatId: string
        itemId?: string
        owner: string
      }) => Promise<QueueItem | null>
    }
    markHanded: {
      mutate: (input: { subChatId: string; itemId: string; owner: string }) => Promise<boolean>
    }
    park: {
      mutate: (input: { subChatId: string; itemId: string }) => Promise<boolean>
    }
    complete: {
      mutate: (input: { subChatId: string; itemId: string }) => Promise<boolean>
    }
    requeue: {
      mutate: (input: { subChatId: string; itemId: string }) => Promise<boolean>
    }
    setPaused: {
      mutate: (input: { subChatId: string; paused: boolean }) => Promise<number>
    }
  }
}

/** Sub-chats this window is sending for, so two wakes cannot send twice. */
const inFlightSends = new Set<string>()
/**
 * Sub-chats this window knows have no queue left in main. Used to drop a claim
 * that arrives after the queue was cleared, which the feed cannot show: a
 * claimed row is hidden from the feed.
 */
const unknownSubChatIds = new Set<string>()
/** Sub-chats with a claim in flight, so a burst of wakes asks main once. */
const claimAttempts = new Set<string>()

/**
 * Which window is asking. Main keys a claim by this, so it can tell a live
 * window from one that reloaded or closed, and hand back what a closed window
 * held. Resolved once, like the storage namespace it matches.
 */
function ownerFor(client: QueueFeedClient): string {
  if (client.owner) return client.owner
  return getWindowId()
}

function senderForSubChat(subChatId: string): Chat<UIMessage> | null {
  if (inFlightSends.has(subChatId)) return null
  const chat = agentChatStore.get(subChatId)
  if (!chat) return null
  // The chat's own status flips to `submitted` synchronously inside
  // `sendMessage`, while the app-wide store is written from a React effect one
  // render later. Checking both is what keeps a dispatch from racing a direct
  // send the user started in the same tick: the queued item would otherwise
  // leave in parallel with their message.
  if (chat.status !== "ready") return null
  if (useStreamingStatusStore.getState().getStatus(subChatId) !== "ready") return null
  return chat
}

/**
 * Sends one claimed row and records what came of it. The caller owns the
 * sub-chat's in-flight slot: it must be taken before this is reached, so the
 * claim and the send are one indivisible unit for this window. Answers the
 * sender's outcome, so a caller that reports success can tell a row that went
 * out from one that was handed back.
 */
async function deliverClaimedItem(
  item: QueueItem,
  chat: Chat<UIMessage>,
  client: QueueFeedClient,
  stopCurrent?: () => Promise<boolean>,
): Promise<QueueSendResult> {
  const subChatId = item.subChatId
  const owner = ownerFor(client)
  const result = await sendClaimedQueueItem({
    item,
    chat,
    stopCurrent,
    markHanded: () => client.queue.markHanded.mutate({ subChatId, itemId: item.id, owner }),
  })
  try {
    switch (result) {
      case "sent":
        await client.queue.complete.mutate({ subChatId, itemId: item.id })
        break
      case "uncertain":
        // The payload was handed over, so nothing here may put it back into
        // the automatic path. It stays visible and paused.
        useStreamingStatusStore.getState().setStatus(subChatId, "error")
        await client.queue.park.mutate({ subChatId, itemId: item.id })
        break
      case "failed":
        // Mark the failure before the requeue lands, so the feed change the
        // requeue produces cannot immediately claim the same row again in a
        // loop. The sender already told the user the item stays queued.
        useStreamingStatusStore.getState().setStatus(subChatId, "error")
        await client.queue.requeue.mutate({ subChatId, itemId: item.id })
        break
      case "cancelled":
        // The claim was cleared or taken over; it is not this window's row.
        break
    }
  } catch (error) {
    // A failed bookkeeping call leaves the row `sending`, which the stall
    // recovery in main and startup recovery both know how to settle.
    console.error("[queue] could not record the send outcome:", error)
  }
  return result
}

/** How long a wake waits for a pane that has not registered its chat yet. */
const WAKE_RETRY_DELAY_MS = 2000
/** Attempts after the first wake, so a missing pane costs one delay, not a loop. */
const WAKE_RETRY_LIMIT = 5
const wakeRetries = new Map<string, number>()

/**
 * Re-ask for a sub-chat whose pane was not up yet. Only a sub-chat this window
 * knows has rows is retried, and only a bounded number of times.
 */
function scheduleWakeRetry(subChatId: string, client: QueueFeedClient): void {
  const state = useQueueProjection.getState()
  const queued =
    (state.queues[subChatId]?.length ?? 0) > 0 || (state.hiddenCounts[subChatId] ?? 0) > 0
  if (!queued) return
  const attempts = wakeRetries.get(subChatId) ?? 0
  if (attempts >= WAKE_RETRY_LIMIT) return
  wakeRetries.set(subChatId, attempts + 1)
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    wakeRetries.delete(subChatId)
    void wakeQueue(subChatId, client)
  }, WAKE_RETRY_DELAY_MS)
  // Node keeps its process alive for a pending timer and the tests run this
  // module there; the renderer has no `unref`, which is why it is optional.
  ;(timer as unknown as { unref?: () => void }).unref?.()
}

/**
 * Ask main for the next item and send it, when this window can. Every wake is
 * just a question; main decides whether there is work and who gets it.
 */
export async function wakeQueue(
  subChatId: string,
  client: QueueFeedClient = trpcClient,
): Promise<void> {
  const chat = senderForSubChat(subChatId)
  if (!chat) {
    // A window mounts its panes after the feed has already replayed, so a wake
    // can arrive before anything here can send for the sub-chat, and a pane
    // that registers later reports no status of its own to wake on. Retrying a
    // bounded number of times covers that window without polling forever: a
    // sub-chat nobody opened keeps its queued messages until it is opened,
    // which is the step's rule for which window sends.
    scheduleWakeRetry(subChatId, client)
    return
  }
  if (claimAttempts.has(subChatId)) return

  claimAttempts.add(subChatId)
  let item: QueueItem | null = null
  try {
    item = await client.queue.claim.mutate({ subChatId, owner: ownerFor(client) })
  } catch (error) {
    console.error("[queue] claim failed:", error)
    return
  } finally {
    claimAttempts.delete(subChatId)
  }
  if (!item) return
  // Nobody here will send this row: the sub-chat was deleted while the claim
  // was in flight, or another send for it started during that await. A claimed
  // row is hidden from the feed, so this is the only place that can say so.
  if (unknownSubChatIds.has(subChatId) || inFlightSends.has(subChatId)) {
    await returnClaimedItem(item, client)
    return
  }
  inFlightSends.add(subChatId)
  try {
    await deliverClaimedItem(item, chat, client)
  } finally {
    inFlightSends.delete(subChatId)
  }
}

/**
 * Give a claimed row back, for a claim this window decided not to use. Leaving
 * it `sending` would hide it until the next claim takes it over.
 */
async function returnClaimedItem(item: QueueItem, client: QueueFeedClient): Promise<void> {
  try {
    await client.queue.requeue.mutate({ subChatId: item.subChatId, itemId: item.id })
  } catch (error) {
    // An un-handed claim is released by the next claim for the sub-chat, so a
    // failed hand-back is recoverable rather than lost.
    console.error("[queue] could not hand a claimed row back:", error)
  }
}

/**
 * Send now: an explicit send, so it both ends a pause and claims that one
 * item, stopping the turn in flight first. Answers whether the item actually
 * went out: `false` when the claim was lost, the callback refused, or the
 * sender handed the row back to the queue.
 */
export async function sendQueueItemNow(
  subChatId: string,
  itemId: string,
  stopCurrent: () => Promise<boolean>,
  client: QueueFeedClient = trpcClient,
): Promise<boolean> {
  if (inFlightSends.has(subChatId)) return false
  // Take the sub-chat's in-flight slot before the first await and hold it
  // through the bookkeeping. Two quick clicks would otherwise both reach main,
  // which hands out one row per request, and both rows would be sent at once.
  inFlightSends.add(subChatId)
  try {
    const chat = agentChatStore.get(subChatId)
    if (!chat) return false
    // Claim the row the user picked before anything else, so the resume below
    // cannot make main hand a different item to this window first. Main allows
    // a paused row through for Send now.
    const item = await client.queue.claim.mutate({
      subChatId,
      itemId,
      owner: ownerFor(client),
    })
    if (!item) return false
    // A click that raced this sub-chat's deletion must not start a send for a
    // row main no longer has. A send that already started cannot be recalled;
    // this stops the ones that had not started yet.
    if (unknownSubChatIds.has(subChatId)) return false
    const outcome = await deliverClaimedItem(item, chat, client, stopCurrent)
    // The user sent something, which ends the pause. Doing it after the send
    // started means the wake this causes cannot race the send itself.
    await resumeQueue(subChatId, client)
    return outcome === "sent"
  } finally {
    inFlightSends.delete(subChatId)
  }
}

/** An explicit send is what ends a pause, so the queue drains again. */
export async function resumeQueue(
  subChatId: string,
  client: QueueFeedClient = trpcClient,
): Promise<void> {
  try {
    await client.queue.setPaused.mutate({ subChatId, paused: false })
  } catch (error) {
    console.error("[queue] resume failed:", error)
  }
}

export function applyQueueFeedItem(
  item: QueueFeedItem,
  client: QueueFeedClient = trpcClient,
): void {
  const sending = item.items.filter((row: QueueItem) => row.status === "sending")
  const cards = item.items.filter((row: QueueItem) => row.status !== "sending").map(toQueueItemView)
  // The sending rows are hidden from the card but still counted, so a chat
  // mid-hand-off is not mistaken for an idle one.
  useQueueProjection.getState().setQueue(item.subChatId, cards, sending.length)
  void wakeQueue(item.subChatId, client)
}

export async function addQueueItem(
  subChatId: string,
  payload: QueuePayload,
  client: QueueFeedClient = trpcClient,
): Promise<boolean> {
  try {
    await client.queue.add.mutate({ subChatId, payload })
    return true
  } catch (error) {
    console.error("[queue] add failed:", error)
    toast.error("Could not queue that message.")
    return false
  }
}

export async function removeQueueItem(
  subChatId: string,
  itemId: string,
  client: QueueFeedClient = trpcClient,
): Promise<void> {
  try {
    await client.queue.remove.mutate({ subChatId, itemId })
  } catch (error) {
    console.error("[queue] remove failed:", error)
  }
}

/**
 * Drop a sub-chat's queue, in this window and in main. The sub-chat is marked
 * empty before main is asked, so a claim already in flight cannot drop a row
 * back into a queue the user just deleted. Resolves once main has cleared, for
 * callers that must not close the sub-chat before its rows are gone.
 */
export async function clearQueueItems(
  subChatId: string,
  client: QueueFeedClient = trpcClient,
): Promise<void> {
  unknownSubChatIds.add(subChatId)
  useQueueProjection.getState().dropQueue(subChatId)
  try {
    const cleared = await client.queue.clear.mutate({ subChatId })
    if (cleared > 0) console.log(`[queue] cleared ${cleared} rows`)
  } catch (error) {
    console.error("[queue] clear failed:", error)
  }
}

export async function setQueuePaused(
  subChatId: string,
  paused: boolean,
  client: QueueFeedClient = trpcClient,
): Promise<boolean> {
  try {
    await client.queue.setPaused.mutate({ subChatId, paused })
    return true
  } catch (error) {
    console.error("[queue] setPaused failed:", error)
    return false
  }
}

/**
 * Start the projection for this window. Returns a stop function that
 * unsubscribes and cancels any pending reconnect.
 */
export function startQueueSync(
  client: QueueFeedClient = trpcClient,
  retryDelayMs: number = FEED_RETRY_DELAY_MS,
): () => void {
  let stopped = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let subscription: { unsubscribe: () => void } | null = null

  const connect = () => {
    if (stopped) return
    subscription?.unsubscribe()
    // The replay carries a sub-chat only while it still has rows, so a
    // projection from before the feed dropped can hold cards main no longer
    // has (another window deleted the sub-chat, or cleared its queue). Start
    // from empty and let the replay, which runs before anything else, fill it.
    useQueueProjection.getState().resetQueues()
    subscription = client.queue.subscribe.subscribe(undefined, {
      onData: (item) => applyQueueFeedItem(item, client),
      onError: (error) => {
        console.error("[queue] subscription error, retrying:", error.message)
        if (stopped || retryTimer) return
        retryTimer = setTimeout(() => {
          retryTimer = null
          connect()
        }, retryDelayMs)
      },
    })
  }

  // A turn reaching ready in this window is the wake that drains the queue for
  // every engine, the ones with a run row and the ones without.
  const stopStatus = useStreamingStatusStore.subscribe(
    (state) => state.statuses,
    (statuses, previousStatuses) => {
      for (const [subChatId, status] of Object.entries(statuses)) {
        if (status === "ready" && previousStatuses[subChatId] !== "ready") {
          void wakeQueue(subChatId, client)
        }
      }
    },
  )

  connect()

  return () => {
    stopped = true
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    subscription?.unsubscribe()
    subscription = null
    stopStatus()
  }
}
