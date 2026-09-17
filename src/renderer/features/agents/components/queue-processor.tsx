"use client"

import type { UIMessage } from "ai"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { trackMessageSent } from "../../../lib/analytics"
import { appStore } from "../../../lib/jotai-store"
import { clearLoading, loadingSubChatsAtom, setLoading } from "../atoms"
import { MENTION_PREFIXES } from "../mentions/agents-mentions-editor"
import { agentChatStore } from "../stores/agent-chat-store"
import { useMessageQueueStore } from "../stores/message-queue-store"
import { startRunFeedSync } from "../stores/run-feed-projection"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { utf8ToBase64 } from "../utils/base64"

// Debounce between processing a queue wakeup and sending (ms). The ready
// signal is the run record settled by the main process and projected into
// the streaming store by the run feed (roadmap step 07), and claude.ts holds
// the finish chunk until the message is persisted, so no long pacing gap is
// needed anymore. The debounce only coalesces the several wakeups one
// transition produces. Was 7000.
const QUEUE_PROCESS_DELAY = 500

// Last-resort safety re-check interval (ms). Status transitions arrive over
// the run feed subscription, which reconnects on error; this interval only
// guards against a missed projection write. Was 2000.
const QUEUE_SAFETY_CHECK_INTERVAL = 30_000

/**
 * Global queue processor component.
 *
 * This component runs at the app level (AgentsLayout) and processes
 * message queues for ALL sub-chats, regardless of which one is currently active.
 *
 * Key insight: Unlike the previous local useEffect in ChatViewInner which only
 * processed the currently active sub-chat's queue, this component listens to
 * ALL queues and streaming statuses globally.
 */
export function QueueProcessor() {
  // Track which sub-chats are currently being processed to avoid double-sends
  const processingRef = useRef<Set<string>>(new Set())
  // Track timers for cleanup
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  useEffect(() => {
    // Project the main-owned run record into the streaming status store so
    // every window sees the same run truth (roadmap step 07).
    const stopRunFeed = startRunFeedSync()

    // Function to process queue for a specific sub-chat
    const processQueue = async (subChatId: string) => {
      // Check if already processing this sub-chat
      if (processingRef.current.has(subChatId)) {
        return
      }

      // Check streaming status
      const status = useStreamingStatusStore.getState().getStatus(subChatId)
      if (status !== "ready") {
        return
      }

      // Get queue for this sub-chat
      const queue = useMessageQueueStore.getState().queues[subChatId] || []
      if (queue.length === 0) {
        return
      }

      // Get the Chat object from agentChatStore
      const chat = agentChatStore.get(subChatId)
      if (!chat) {
        return
      }

      // Mark as processing
      processingRef.current.add(subChatId)

      // Pop the first item from queue (atomic operation)
      const item = useMessageQueueStore.getState().popItem(subChatId, queue[0].id)
      if (!item) {
        processingRef.current.delete(subChatId)
        return
      }

      try {
        // Build message parts from queued item
        const parts: UIMessage["parts"] = [
          ...(item.images || []).map((img) => ({
            type: "data-image" as const,
            data: {
              url: img.url,
              mediaType: img.mediaType,
              filename: img.filename,
              base64Data: img.base64Data,
            },
          })),
          ...(item.files || []).map((f) => ({
            type: "data-file" as const,
            data: {
              url: f.url,
              mediaType: f.mediaType,
              filename: f.filename,
              size: f.size,
            },
          })),
        ]

        // Expand text contexts, diff text contexts, and pasted texts as mention tokens
        let mentionPrefix = ""

        if (item.textContexts && item.textContexts.length > 0) {
          const quoteMentions = item.textContexts.map((tc) => {
            const preview = tc.text.slice(0, 50).replace(/[:[\]]/g, "")
            const encodedText = utf8ToBase64(tc.text)
            return `@[${MENTION_PREFIXES.QUOTE}${preview}:${encodedText}]`
          })
          mentionPrefix += `${quoteMentions.join(" ")} `
        }

        if (item.diffTextContexts && item.diffTextContexts.length > 0) {
          const diffMentions = item.diffTextContexts.map((dtc) => {
            const preview = dtc.text.slice(0, 50).replace(/[:[\]]/g, "")
            const encodedText = utf8ToBase64(dtc.text)
            const lineNum = dtc.lineNumber || 0
            return `@[${MENTION_PREFIXES.DIFF}${dtc.filePath}:${lineNum}:${preview}:${encodedText}]`
          })
          mentionPrefix += `${diffMentions.join(" ")} `
        }

        if (item.pastedTexts && item.pastedTexts.length > 0) {
          const pastedMentions = item.pastedTexts.map((pt) => {
            const sanitizedPreview = pt.preview.replace(/[:[\]|]/g, "")
            return `@[${MENTION_PREFIXES.PASTED}${pt.size}:${sanitizedPreview}|${pt.filePath}]`
          })
          mentionPrefix += `${pastedMentions.join(" ")} `
        }

        if (item.message || mentionPrefix) {
          parts.push({ type: "text", text: mentionPrefix + (item.message || "") })
        }

        // Get mode from sub-chat store for analytics
        const subChatMeta = useAgentSubChatStore
          .getState()
          .allSubChats.find((sc) => sc.id === subChatId)
        const mode = subChatMeta?.mode || "agent"

        // Track message sent
        trackMessageSent({
          workspaceId: subChatId,
          messageLength: item.message.length,
          mode,
        })

        // Update timestamps
        useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)

        // Set loading state for sidebar indicator
        const parentChatId = agentChatStore.getParentChatId(subChatId)
        if (parentChatId) {
          setLoading(
            (fn) => appStore.set(loadingSubChatsAtom, fn(appStore.get(loadingSubChatsAtom))),
            subChatId,
            parentChatId,
          )
        }

        // Signal active-chat to scroll to bottom BEFORE sending so that
        // shouldAutoScrollRef is true for the entire streaming duration.
        // (sendMessage awaits the full stream, so placing this after would
        // only scroll after the response is complete.)
        useMessageQueueStore.getState().triggerQueueSent(subChatId)

        // Send message using Chat's sendMessage method
        await chat.sendMessage({ role: "user", parts })
      } catch (error) {
        console.error(`[QueueProcessor] Error processing queue:`, error)

        // Requeue the item at the front so it can be retried
        useMessageQueueStore.getState().prependItem(subChatId, item)

        // Set error status (will be cleared on next successful send or manual retry)
        useStreamingStatusStore.getState().setStatus(subChatId, "error")

        // Clear loading state since send failed
        clearLoading(
          (fn) => appStore.set(loadingSubChatsAtom, fn(appStore.get(loadingSubChatsAtom))),
          subChatId,
        )

        // Notify user
        toast.error("Failed to send queued message. It will be retried.")
      } finally {
        processingRef.current.delete(subChatId)
        // Re-kick after releasing lock to avoid lost wakeups
        setTimeout(checkAllQueues, 0)
      }
    }

    // Schedule processing for a sub-chat with delay.
    // If a timer is already pending for this sub-chat, leave it alone so that
    // repeated checkAllQueues calls (from the safety interval or store
    // subscriptions) cannot starve a long delay by resetting it on every tick.
    const scheduleProcessing = (subChatId: string) => {
      if (timersRef.current.has(subChatId)) {
        return
      }

      const timer = setTimeout(() => {
        timersRef.current.delete(subChatId)
        processQueue(subChatId)
      }, QUEUE_PROCESS_DELAY)

      timersRef.current.set(subChatId, timer)
    }

    // Check all queues and schedule processing for ready sub-chats
    function checkAllQueues() {
      const queues = useMessageQueueStore.getState().queues

      for (const subChatId of Object.keys(queues)) {
        const queue = queues[subChatId]
        if (!queue || queue.length === 0) continue

        const status = useStreamingStatusStore.getState().getStatus(subChatId)

        // Process when ready, or retry on error status
        if ((status === "ready" || status === "error") && !processingRef.current.has(subChatId)) {
          // If error status, clear it before retrying
          if (status === "error") {
            useStreamingStatusStore.getState().setStatus(subChatId, "ready")
          }
          scheduleProcessing(subChatId)
        }
      }
    }

    // Subscribe to queue changes with selector (requires subscribeWithSelector middleware)
    const unsubscribeQueue = useMessageQueueStore.subscribe(
      (state) => state.queues,
      () => checkAllQueues(),
    )

    // Subscribe to streaming status changes with selector
    const unsubscribeStatus = useStreamingStatusStore.subscribe(
      (state) => state.statuses,
      () => checkAllQueues(),
    )

    // Initial check
    checkAllQueues()

    // Periodic safety re-check: catches missed status transitions that could
    // leave the queue stalled (e.g., subscription edge cases on stream end,
    // component remounts mid-stream, or transports that don't fire onFinish).
    const safetyInterval = setInterval(checkAllQueues, QUEUE_SAFETY_CHECK_INTERVAL)

    // Cleanup
    return () => {
      stopRunFeed()
      unsubscribeQueue()
      unsubscribeStatus()
      clearInterval(safetyInterval)

      // Clear all timers
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  // This component doesn't render anything
  return null
}
