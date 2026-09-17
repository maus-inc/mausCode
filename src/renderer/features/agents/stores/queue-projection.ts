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
import { trpcClient } from "../../../lib/trpc"
import { sendClaimedQueueItem } from "../lib/queue-send"
import { agentChatStore } from "./agent-chat-store"
import { useStreamingStatusStore } from "./streaming-status-store"

/** Stable empty list, so an empty queue does not re-render its card. */
export const EMPTY_PROJECTED_QUEUE: QueueItemView[] = []

/** What the memory guards ask before they evict a chat instance. */
export function hasQueuedMessages(subChatId: string): boolean {
  return (useQueueProjection.getState().queues[subChatId]?.length ?? 0) > 0
}

const FEED_RETRY_DELAY_MS = 2000

interface QueueProjectionState {
  /** Card items per sub-chat: the rows the indicator shows, in order. */
  queues: Record<string, QueueItemView[]>
  setQueue: (subChatId: string, items: QueueItemView[]) => void
  dropQueue: (subChatId: string) => void
}

export const useQueueProjection = create<QueueProjectionState>()(
  subscribeWithSelector((set) => ({
    queues: {},
    setQueue: (subChatId, items) => {
      set((state) => {
        const current = state.queues[subChatId]
        if (
          current &&
          current.length === items.length &&
          current.every(
            (item, index) => item.id === items[index].id && item.status === items[index].status,
          )
        ) {
          return state
        }
        return { queues: { ...state.queues, [subChatId]: items } }
      })
    },
    dropQueue: (subChatId) => {
      set((state) => {
        if (!(subChatId in state.queues)) return state
        const queues = { ...state.queues }
        delete queues[subChatId]
        return { queues }
      })
    },
  })),
)

export type QueueFeedClient = {
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
      mutate: (input: { subChatId: string; itemId?: string }) => Promise<QueueItem | null>
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
/** Sub-chats with a claim in flight, so a burst of wakes asks main once. */
const claimAttempts = new Set<string>()

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

async function deliverClaimedItem(
  item: QueueItem,
  chat: Chat<UIMessage>,
  client: QueueFeedClient,
  stopCurrent?: () => Promise<void>,
): Promise<void> {
  const subChatId = item.subChatId
  inFlightSends.add(subChatId)
  let result: "sent" | "failed" = "failed"
  try {
    result = await sendClaimedQueueItem({ item, chat, stopCurrent })
  } finally {
    inFlightSends.delete(subChatId)
  }
  try {
    if (result === "sent") {
      await client.queue.complete.mutate({ subChatId, itemId: item.id })
    } else {
      // Mark the failure before the requeue lands, so the feed change the
      // requeue produces cannot immediately claim the same row again in a
      // loop. The sender already told the user the item stays queued.
      useStreamingStatusStore.getState().setStatus(subChatId, "error")
      await client.queue.requeue.mutate({ subChatId, itemId: item.id })
    }
  } catch (error) {
    // A failed bookkeeping call leaves the row `sending`, which startup
    // recovery returns to the queue.
    console.error("[queue] could not record the send outcome:", error)
  }
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
  if (!chat || claimAttempts.has(subChatId)) return

  claimAttempts.add(subChatId)
  let item: QueueItem | null = null
  try {
    item = await client.queue.claim.mutate({ subChatId })
  } catch (error) {
    console.error("[queue] claim failed:", error)
    return
  } finally {
    claimAttempts.delete(subChatId)
  }
  if (!item) return
  await deliverClaimedItem(item, chat, client)
}

/**
 * Send now: an explicit send, so it both ends a pause and claims that one
 * item, stopping the turn in flight first.
 */
export async function sendQueueItemNow(
  subChatId: string,
  itemId: string,
  stopCurrent: () => Promise<void>,
  client: QueueFeedClient = trpcClient,
): Promise<boolean> {
  if (inFlightSends.has(subChatId)) return false
  const chat = agentChatStore.get(subChatId)
  if (!chat) return false
  // Claim the row the user picked before anything else, so the resume below
  // cannot make main hand a different item to this window first. Main allows a
  // paused row through for Send now.
  const item = await client.queue.claim.mutate({ subChatId, itemId })
  if (!item) return false
  await deliverClaimedItem(item, chat, client, stopCurrent)
  // The user sent something, which ends the pause. Doing it after the send
  // started means the wake this causes cannot race the send itself.
  await resumeQueue(subChatId, client)
  return true
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
  const cards = item.items.filter((row: QueueItem) => row.status !== "sending").map(toQueueItemView)
  useQueueProjection.getState().setQueue(item.subChatId, cards)
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

export function clearQueueItems(subChatId: string, client: QueueFeedClient = trpcClient): void {
  useQueueProjection.getState().dropQueue(subChatId)
  void client.queue.clear.mutate({ subChatId }).catch((error: unknown) => {
    console.error("[queue] clear failed:", error)
  })
}

export async function setQueuePaused(
  subChatId: string,
  paused: boolean,
  client: QueueFeedClient = trpcClient,
): Promise<void> {
  try {
    await client.queue.setPaused.mutate({ subChatId, paused })
  } catch (error) {
    console.error("[queue] setPaused failed:", error)
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
