"use client"

import { useEffect } from "react"
import { startQueueSync } from "../stores/queue-projection"
import { startRunFeedSync } from "../stores/run-feed-projection"

/**
 * Global queue sync (roadmap step 08). Mounted once per window, it keeps the
 * two main-owned feeds alive for every sub-chat: the run feed projects run
 * state into the streaming status store, and the queue projection projects the
 * queued rows and asks main for work to send. Renders nothing and owns no
 * timers.
 */
export function QueueSync() {
  useEffect(() => {
    const stopRunFeed = startRunFeedSync()
    const stopQueue = startQueueSync()
    return () => {
      stopQueue()
      stopRunFeed()
    }
  }, [])

  return null
}
