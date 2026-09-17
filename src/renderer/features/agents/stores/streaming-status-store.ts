import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"

export type StreamingStatus = "ready" | "streaming" | "submitted" | "error"

interface StreamingStatusState {
  // Map: subChatId -> streaming status
  statuses: Record<string, StreamingStatus>

  // Actions
  setStatus: (subChatId: string, status: StreamingStatus) => void
  getStatus: (subChatId: string) => StreamingStatus
  isStreaming: (subChatId: string) => boolean
  clearStatus: (subChatId: string) => void

  // Get all sub-chats that are ready (not streaming)
  getReadySubChats: () => string[]
}

export const useStreamingStatusStore = create<StreamingStatusState>()(
  subscribeWithSelector((set, get) => ({
    statuses: {},

    setStatus: (subChatId, status) => {
      set((state) => ({
        statuses: {
          ...state.statuses,
          [subChatId]: status,
        },
      }))
    },

    getStatus: (subChatId) => {
      return get().statuses[subChatId] ?? "ready"
    },

    isStreaming: (subChatId) => {
      const status = get().statuses[subChatId] ?? "ready"
      return status === "streaming" || status === "submitted"
    },

    clearStatus: (subChatId) => {
      set((state) => {
        const newStatuses = { ...state.statuses }
        delete newStatuses[subChatId]
        return { statuses: newStatuses }
      })
    },

    getReadySubChats: () => {
      const { statuses } = get()
      return Object.entries(statuses)
        .filter(([_, status]) => status === "ready")
        .map(([subChatId]) => subChatId)
    },
  })),
)

/** Safety timeout for a wait, so no caller can hang forever on a status that
 *  never arrives. */
const STREAMING_READY_TIMEOUT_MS = 30_000

/**
 * Wait until a sub-chat's status leaves streaming, by subscribing to the
 * status store. Resolves immediately when it is already done, and after the
 * timeout when the store never reports it, so a caller is never stuck.
 */
export function waitForStreamingReady(subChatId: string): Promise<void> {
  return new Promise((resolve) => {
    if (!useStreamingStatusStore.getState().isStreaming(subChatId)) {
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      console.warn(
        `[waitForStreamingReady] Timed out after ${STREAMING_READY_TIMEOUT_MS}ms for subChat ${subChatId.slice(-8)}, proceeding anyway`,
      )
      unsub()
      resolve()
    }, STREAMING_READY_TIMEOUT_MS)

    const unsub = useStreamingStatusStore.subscribe(
      (state) => state.statuses[subChatId],
      (status) => {
        if (status === "ready" || status === undefined) {
          clearTimeout(timeout)
          unsub()
          resolve()
        }
      },
    )
  })
}

/**
 * Wait until a sub-chat's status reports a live turn (`streaming` or
 * `submitted`), which is what a caller waits for after invoking a send: the
 * engine accepted the message. Resolves immediately when a turn is already
 * live. `error` and `ready` do not resolve it, because neither means the
 * message went out. The caller owns the subscription it opens and drops it
 * with `cancel` when it stops waiting, so a race this promise lost cannot
 * leave a listener behind.
 */
export function waitForTurnStart(subChatId: string): {
  promise: Promise<void>
  /** Drop the subscription without resolving, for a caller that stopped waiting. */
  cancel: () => void
} {
  const current = useStreamingStatusStore.getState().getStatus(subChatId)
  if (current === "streaming" || current === "submitted") {
    return { promise: Promise.resolve(), cancel: () => {} }
  }

  let unsubscribe: (() => void) | null = null
  const promise = new Promise<void>((resolve) => {
    unsubscribe = useStreamingStatusStore.subscribe(
      (state) => state.statuses[subChatId],
      (status) => {
        if (status === "streaming" || status === "submitted") {
          unsubscribe?.()
          unsubscribe = null
          resolve()
        }
      },
    )
  })

  return {
    promise,
    cancel: () => {
      unsubscribe?.()
      unsubscribe = null
    },
  }
}
