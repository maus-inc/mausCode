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

/** How long a caller waits for a turn to stop before it gives up. */
const STREAMING_READY_TIMEOUT_MS = 30_000

/**
 * Wait until a sub-chat's status leaves streaming, by subscribing to the
 * status store. Resolves `true` when it is already done or when the store
 * reports it.
 *
 * Resolves `false` when the status never arrives inside the timeout. A caller
 * that sends into the sub-chat must treat `false` as "the previous turn is
 * still live" and stop, because starting a send there would run two turns on
 * one session. Waiting is only a bound on how long the caller holds off, never
 * a licence to proceed.
 */
export function waitForStreamingReady(subChatId: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!useStreamingStatusStore.getState().isStreaming(subChatId)) {
      resolve(true)
      return
    }

    const timeout = setTimeout(() => {
      console.warn(
        `[waitForStreamingReady] Timed out after ${STREAMING_READY_TIMEOUT_MS}ms for subChat ${subChatId.slice(-8)}; the turn is still live`,
      )
      unsub()
      resolve(false)
    }, STREAMING_READY_TIMEOUT_MS)

    const unsub = useStreamingStatusStore.subscribe(
      (state) => state.statuses[subChatId],
      (status) => {
        if (status === "ready" || status === undefined) {
          clearTimeout(timeout)
          unsub()
          resolve(true)
        }
      },
    )
  })
}

/** How long a caller waits for a turn to report itself before it stops. */
const TURN_START_TIMEOUT_MS = 60_000

/**
 * Wait until a sub-chat's status reports a live turn (`streaming` or
 * `submitted`), which is what a caller waits for after invoking a send: the
 * engine accepted the message. Resolves immediately when a turn is already
 * live. `error` and `ready` do not resolve it, because neither means the
 * message went out.
 *
 * `expired` resolves when no turn reported itself inside the timeout, and it
 * only gives up on the status: the send call is still the thing that decides
 * what happened, so a caller that sees this keeps waiting for that call and
 * stops holding a listener on the store. The caller owns the subscription it
 * opens and drops it with `cancel` when it stops waiting, so a race this
 * promise lost cannot leave a listener behind.
 */
export function waitForTurnStart(
  subChatId: string,
  timeoutMs: number = TURN_START_TIMEOUT_MS,
): {
  promise: Promise<void>
  /** Resolves when the wait gave up; it never resolves as a live turn. */
  expired: Promise<void>
  /** Drop the subscription without resolving, for a caller that stopped waiting. */
  cancel: () => void
} {
  const current = useStreamingStatusStore.getState().getStatus(subChatId)
  if (current === "streaming" || current === "submitted") {
    return {
      promise: Promise.resolve(),
      expired: new Promise<void>(() => {}),
      cancel: () => {},
    }
  }

  let unsubscribe: (() => void) | null = null
  let expireTimer: ReturnType<typeof setTimeout> | null = null
  let expire: () => void = () => {}
  const expired = new Promise<void>((resolve) => {
    expire = resolve
  })
  const promise = new Promise<void>((resolve) => {
    unsubscribe = useStreamingStatusStore.subscribe(
      (state) => state.statuses[subChatId],
      (status) => {
        if (status === "streaming" || status === "submitted") {
          if (expireTimer) clearTimeout(expireTimer)
          expireTimer = null
          unsubscribe?.()
          unsubscribe = null
          resolve()
        }
      },
    )
  })

  expireTimer = setTimeout(() => {
    expireTimer = null
    unsubscribe?.()
    unsubscribe = null
    console.warn(
      `[waitForTurnStart] no turn reported itself for subChat ${subChatId.slice(-8)} inside ${timeoutMs}ms; the send call still decides the outcome`,
    )
    expire()
  }, timeoutMs)
  // Node keeps its process alive for a pending timer and the tests run this
  // module there; the renderer has no `unref`.
  ;(expireTimer as unknown as { unref?: () => void }).unref?.()

  return {
    promise,
    expired,
    cancel: () => {
      if (expireTimer) clearTimeout(expireTimer)
      expireTimer = null
      unsubscribe?.()
      unsubscribe = null
    },
  }
}
