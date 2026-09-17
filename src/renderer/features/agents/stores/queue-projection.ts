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
      // produces one, and a claim still in flight would arrive after it. While
      // that clear is still in flight neither does a feed *with* rows: main has
      // not deleted them yet, so a reading that carries them is older than the
      // clear, and honouring it would let a wake send a message the user just
      // asked to delete.
      if (items.length > 0 && !isClearing(subChatId)) {
        unknownSubChatIds.delete(subChatId)
      }
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
      // The marks describe main's rows, not this window's cards, so they go
      // with the cards: the replay that follows a reset is what says what main
      // has. A mark left standing after a reconnect would hold sends back for a
      // sub-chat whose rows are in main and whose feed never arrived.
      unknownSubChatIds.clear()
      clearingSubChatIds.clear()
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
      mutate: (input: { subChatId: string; itemId: string; owner: string }) => Promise<boolean>
    }
    complete: {
      mutate: (input: { subChatId: string; itemId: string; owner: string }) => Promise<boolean>
    }
    requeue: {
      mutate: (input: { subChatId: string; itemId: string; owner: string }) => Promise<boolean>
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

/**
 * Sub-chats whose rows the user asked to drop, each with the number of answers
 * still owed: two clears can overlap, and the hold ends only when the last one
 * has an answer.
 */
const clearingSubChatIds = new Map<string, number>()

/** Whether a clear for the sub-chat is still waiting for its answer. */
function isClearing(subChatId: string): boolean {
  return (clearingSubChatIds.get(subChatId) ?? 0) > 0
}

/** Hold this sub-chat's sends back until this clear answers. */
function holdWhileClearing(subChatId: string): void {
  clearingSubChatIds.set(subChatId, (clearingSubChatIds.get(subChatId) ?? 0) + 1)
}

/** Answer one clear. Says whether it was the last one outstanding. */
function answerClear(subChatId: string): boolean {
  const owed = (clearingSubChatIds.get(subChatId) ?? 1) - 1
  if (owed > 0) {
    clearingSubChatIds.set(subChatId, owed)
    return false
  }
  clearingSubChatIds.delete(subChatId)
  return true
}

/** Sub-chats with a claim in flight, so a burst of wakes asks main once. */
const claimAttempts = new Set<string>()

/**
 * Sub-chats whose claim was in flight when their sync stopped. The row is still
 * main's to hand back, and a window that stopped syncing must not send it — the
 * same reason the cleanup clears the pending wakes.
 */
const claimsForStoppedSyncs = new Set<string>()

/** Snapshot the claims a stopping sync leaves in flight. */
function noteStoppedSync(): void {
  for (const subChatId of claimAttempts) claimsForStoppedSyncs.add(subChatId)
}

/**
 * Answers once whether this sub-chat's claim outlived its sync, and forgets the
 * answer: a mark left behind would swallow the next claim for the sub-chat,
 * which belongs to a live sync.
 */
function claimOutlivedItsSync(subChatId: string): boolean {
  if (!claimsForStoppedSyncs.has(subChatId)) return false
  claimsForStoppedSyncs.delete(subChatId)
  return true
}

/**
 * Claims this window could not hand back. While one stands, main still has this
 * window's un-handed claim and refuses the next one for the sub-chat, so the
 * hand-back is repeated on the next wake rather than waiting out the lease.
 */
const pendingHandBacks = new Map<string, QueueItem>()

/**
 * Which window is asking. Main keys a claim by this, so it can tell a live
 * window from one that reloaded or closed, and hand back what a closed window
 * held. Resolved once, like the storage namespace it matches.
 */
function ownerFor(client: QueueFeedClient): string {
  if (client.owner) return client.owner
  return getWindowId()
}

/** Sub-chats this window knows to have rows, visible or held `sending`. */
function subChatsWithQueuedRows(): string[] {
  const state = useQueueProjection.getState()
  return [...new Set([...Object.keys(state.queues), ...Object.keys(state.hiddenCounts)])]
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
  const recordOutcome = async (): Promise<void> => {
    switch (result) {
      case "sent":
        await client.queue.complete.mutate({ subChatId, itemId: item.id, owner })
        break
      case "uncertain":
        // The payload was handed over, so nothing here may put it back into
        // the automatic path. It stays visible and paused.
        useStreamingStatusStore.getState().setStatus(subChatId, "error")
        await client.queue.park.mutate({ subChatId, itemId: item.id, owner })
        break
      case "failed":
        // Mark the failure before the requeue lands, so the feed change the
        // requeue produces cannot immediately claim the same row again in a
        // loop. The sender already told the user the item stays queued.
        useStreamingStatusStore.getState().setStatus(subChatId, "error")
        await client.queue.requeue.mutate({ subChatId, itemId: item.id, owner })
        break
      case "cancelled":
        // The claim was cleared or taken over; it is not this window's row.
        break
    }
  }
  // Two attempts: each of these calls is idempotent for a row that is still
  // `sending`, so a repeat after a transient failure is safe, and without it a
  // single failed call leaves the row hidden until the next wake of this
  // sub-chat parks it or startup recovery does.
  try {
    await recordOutcome()
  } catch (error) {
    console.error("[queue] could not record the send outcome, retrying once:", error)
    try {
      await recordOutcome()
    } catch (retryError) {
      console.error("[queue] the send outcome is unrecorded; the row stays `sending`:", retryError)
    }
  }
  return result
}

/** How long a wake waits for a pane that has not registered its chat yet. */
const WAKE_RETRY_DELAY_MS = 2000
/** Attempts after the first wake, so a missing pane costs one delay, not a loop. */
const WAKE_RETRY_LIMIT = 5
const wakeRetries = new Map<string, number>()
/** Pending retries, so stopping the feed cannot leave one behind to fire. */
const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Re-ask a question main has not answered. That is a wake whose pane was not up
 * yet, or a claim call that failed on its way to main. Only a sub-chat this
 * window knows has rows is retried, and only a bounded number of times, so a
 * failure that persists is not asked about forever. The count is the
 * sequence's, not the attempt's: it is
 * dropped as soon as main answers or the queue is gone, never as a retry
 * starts, or every retry would restart the sequence and the limit would bound
 * nothing. An attempt is spent when a retry is scheduled, and a wake that
 * arrives while one is pending spends nothing: the pending retry is already the
 * next question, and letting a burst of feed updates spend the budget would
 * leave the pane no retry at all.
 */
function scheduleWakeRetry(subChatId: string, client: QueueFeedClient): void {
  if (wakeTimers.has(subChatId)) return
  const state = useQueueProjection.getState()
  const queued =
    (state.queues[subChatId]?.length ?? 0) > 0 || (state.hiddenCounts[subChatId] ?? 0) > 0
  if (!queued) {
    // Nothing left to wake for, so a later queue starts its own sequence.
    wakeRetries.delete(subChatId)
    return
  }
  const attempts = wakeRetries.get(subChatId) ?? 0
  if (attempts >= WAKE_RETRY_LIMIT) return
  wakeRetries.set(subChatId, attempts + 1)
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    wakeTimers.delete(subChatId)
    void wakeQueue(subChatId, client)
  }, WAKE_RETRY_DELAY_MS)
  // One pending retry per sub-chat, which is also what stopping the feed clears.
  wakeTimers.set(subChatId, timer)
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
  // The user asked for this sub-chat's rows to go and main has not answered
  // yet, so nothing may act on a reading taken before that answer. A feed
  // carrying those rows can arrive while the delete is in flight; sending one
  // would deliver a message the user just asked to delete, and handing it back
  // would only make the feed speak again. The claim waits for the answer.
  if (isClearing(subChatId)) return
  // A claim this window failed to hand back goes first: while it stands, main
  // has this window's un-handed claim and refuses the next one, so nothing
  // below could work anyway.
  const owed = pendingHandBacks.get(subChatId)
  if (owed) {
    await returnClaimedItem(owed, client)
    if (pendingHandBacks.has(subChatId)) return
  }
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
    // The one failure the feed cannot heal on its own: nothing changed in main,
    // so no later feed event is coming, and a sub-chat that is already `ready`
    // will not turn ready again. Ask again, on the same bounded budget a wake
    // with no pane spends.
    scheduleWakeRetry(subChatId, client)
    return
  } finally {
    claimAttempts.delete(subChatId)
  }
  // Consumed for every answer, a row or none: the mark belongs to this claim,
  // and one left behind would hand the next live sync's row back.
  const outlivedItsSync = claimOutlivedItsSync(subChatId)
  // Main answered, so the sequence of unanswered questions for this sub-chat is
  // over, whether it had a row for us or not.
  wakeRetries.delete(subChatId)
  if (!item) return
  if (outlivedItsSync) {
    // The sync that asked for this row stopped while the claim was in flight,
    // and the cleanup drops its pending wakes for the same reason: a window
    // that stopped syncing does not send. The row goes back so the next sync
    // can take it.
    await returnClaimedItem(item, client)
    return
  }
  // Nobody here will send this row: the sub-chat was deleted while the claim
  // was in flight, another send for it started during that await, or a turn
  // went live here in the meantime — which the question asked before the claim
  // cannot answer, because the answer is one round trip old. A claimed row is
  // hidden from the feed, so this is the only place that can say so.
  const senderNow = senderForSubChat(subChatId)
  if (unknownSubChatIds.has(subChatId) || !senderNow) {
    await returnClaimedItem(item, client)
    return
  }
  inFlightSends.add(subChatId)
  try {
    await deliverClaimedItem(item, senderNow, client)
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
    await client.queue.requeue.mutate({
      subChatId: item.subChatId,
      itemId: item.id,
      owner: ownerFor(client),
    })
    pendingHandBacks.delete(item.subChatId)
  } catch (error) {
    // The row stays `sending`, and main refuses this window's next claim for
    // the sub-chat while its own un-handed claim stands. Keep it and hand it
    // back on the next wake, instead of waiting for the lease to run out with
    // the row hidden from every card.
    pendingHandBacks.set(item.subChatId, item)
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
    if (unknownSubChatIds.has(subChatId)) {
      // The clear the user asked for may have failed, in which case this row
      // still exists in main and would otherwise sit `sending` with nobody to
      // send it. Hand it back before dropping it.
      await returnClaimedItem(item, client)
      return false
    }
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
    // A resume that did not land leaves the rows the user's stop held back
    // paused in main, so a direct send would not drain the queue behind it.
    // The send itself is not affected; the user is told the queue is waiting.
    console.error("[queue] resume failed:", error)
    toast.error("Could not resume the queue; queued messages will wait.")
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
    // The card is not updated optimistically: it is the feed that drops the
    // row, so a removal that did not land leaves it in place, and the click
    // would look like a no-op. Say so.
    console.error("[queue] remove failed:", error)
    toast.error("Could not remove that queued message.")
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
  const state = useQueueProjection.getState()
  // What the card held, kept for a clear that does not land: main still has
  // those rows then, and the queue the user failed to delete is the queue the
  // card has to keep showing.
  const cards = state.queues[subChatId] ?? EMPTY_PROJECTED_QUEUE
  const hidden = state.hiddenCounts[subChatId] ?? 0
  unknownSubChatIds.add(subChatId)
  holdWhileClearing(subChatId)
  state.dropQueue(subChatId)
  try {
    const cleared = await client.queue.clear.mutate({ subChatId })
    if (cleared > 0) console.log(`[queue] cleared ${cleared} rows`)
  } catch (error) {
    // Main still has this sub-chat's rows, so the mark that says it has none
    // would keep every later wake from sending them, and a dropped card would
    // hide rows that are still there. Forget the mark, and put the card back
    // only if the feed has not spoken since the drop: an entry for the sub-chat
    // means a feed update landed while the clear was in flight, and that
    // reading is newer than the snapshot taken before it.
    unknownSubChatIds.delete(subChatId)
    const current = useQueueProjection.getState()
    if (!(subChatId in current.queues) && !(subChatId in current.hiddenCounts)) {
      current.setQueue(subChatId, cards, hidden)
    }
    console.error("[queue] clear failed:", error)
  } finally {
    // The clear has an answer now, so claims may go out again. A row this
    // window learned about while the delete was in flight was left alone, and
    // a feed that arrived then is not a reason to ask again on its own, so ask
    // once here: the answer is the event that ends the hold.
    if (answerClear(subChatId) && hasQueuedMessages(subChatId)) {
      void wakeQueue(subChatId, client)
    }
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

  // The third source is a pane that appears: a window mounts its panes after
  // the feed has already replayed, and a pane whose sub-chat is already `ready`
  // writes no status, so nothing else would ask for the rows left waiting.
  const stopSenders = agentChatStore.subscribe(() => {
    for (const subChatId of subChatsWithQueuedRows()) {
      void wakeQueue(subChatId, client)
    }
  })

  connect()

  return () => {
    stopSenders()
    stopped = true
    // Claims this sync leaves in flight are given back, not finished, and a
    // hand-back that is still owed is retried here: the window may keep
    // running, but nothing it stopped syncing for is sent or held.
    noteStoppedSync()
    for (const item of pendingHandBacks.values()) void returnClaimedItem(item, client)
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    // A retry still pending would wake, claim and send for a window that has
    // stopped syncing, so it goes with the subscription.
    for (const timer of wakeTimers.values()) clearTimeout(timer)
    wakeTimers.clear()
    wakeRetries.clear()
    subscription?.unsubscribe()
    subscription = null
    stopStatus()
  }
}
