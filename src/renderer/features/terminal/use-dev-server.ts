/**
 * NOTE (transplant): useDevServer: start/stop/reconcile a project dev server in a terminal pane.
 * Source: sylvaindiv/1code (Apache-2.0). UI strings translated FR->EN on port.
 */

import { useAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"
import { trpc } from "../../lib/trpc"
import {
  activeTerminalIdAtom,
  devServerRunningAtomFamily,
  terminalSidebarOpenAtomFamily,
  terminalsAtom,
} from "./atoms"
import {
  DEV_SERVER_TERMINAL_ID,
  DEV_SERVER_TERMINAL_NAME,
  getDevServerPaneId,
} from "./dev-server-constants"
import type { TerminalInstance } from "./types"

interface UseDevServerArgs {
  chatId: string
  scopeKey: string
  cwd: string
}

const STOP_GRACE_PERIOD_MS = 1500

export function useDevServer({ chatId, scopeKey, cwd }: UseDevServerArgs) {
  const paneId = useMemo(() => getDevServerPaneId(scopeKey), [scopeKey])

  const runningAtom = useMemo(() => devServerRunningAtomFamily(scopeKey), [scopeKey])
  const [isRunning, setIsRunning] = useAtom(runningAtom)

  const sidebarAtom = useMemo(() => terminalSidebarOpenAtomFamily(chatId), [chatId])
  const [, setSidebarOpen] = useAtom(sidebarAtom)

  const [allTerminals, setAllTerminals] = useAtom(terminalsAtom)
  const [allActiveIds, setAllActiveIds] = useAtom(activeTerminalIdAtom)

  const detectQuery = trpc.devServer.detect.useQuery({ cwd }, { enabled: !!cwd, staleTime: 30_000 })

  const createOrAttachMutation = trpc.terminal.createOrAttach.useMutation()
  const signalMutation = trpc.terminal.signal.useMutation()
  const killMutation = trpc.terminal.kill.useMutation()

  const trpcUtils = trpc.useUtils()

  // Reconciliation: on mount or when scopeKey changes, check if the backend
  // session is alive. If our atom thinks "running" but backend disagrees,
  // purge the ghost instance and reset state. This handles the case where
  // the user quit the app while the dev server was running.
  const reconciledRef = useRef<string | null>(null)
  useEffect(() => {
    if (reconciledRef.current === paneId) return
    reconciledRef.current = paneId

    let cancelled = false
    ;(async () => {
      try {
        const session = await trpcUtils.terminal.getSession.fetch(paneId)
        if (cancelled) return

        const alive = !!session?.isAlive
        if (alive) {
          // Backend has the session — make sure local state reflects it
          setIsRunning(true)
        } else {
          // Backend doesn't have it (or it's dead) — purge any ghost
          setIsRunning(false)
          setAllTerminals((prev) => {
            const list = prev[scopeKey]
            if (!list) return prev
            const filtered = list.filter((t) => t.id !== DEV_SERVER_TERMINAL_ID)
            if (filtered.length === list.length) return prev
            return { ...prev, [scopeKey]: filtered }
          })
          setAllActiveIds((prev) => {
            if (prev[scopeKey] !== DEV_SERVER_TERMINAL_ID) return prev
            const remaining = (allTerminals[scopeKey] || []).filter(
              (t) => t.id !== DEV_SERVER_TERMINAL_ID,
            )
            return {
              ...prev,
              [scopeKey]: remaining[remaining.length - 1]?.id ?? null,
            }
          })
        }
      } catch (err) {
        console.warn("[useDevServer] reconciliation failed:", err)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, scopeKey])

  // Subscribe to terminal stream while running, to detect autonomous exit
  // (e.g. dev server crashes, user kills it manually). On exit, reset state
  // and remove the instance from the terminals atom.
  trpc.terminal.stream.useSubscription(paneId, {
    enabled: isRunning,
    onData: (event) => {
      if (event.type !== "exit") return
      setIsRunning(false)
      setAllTerminals((prev) => {
        const list = prev[scopeKey]
        if (!list) return prev
        const filtered = list.filter((t) => t.id !== DEV_SERVER_TERMINAL_ID)
        if (filtered.length === list.length) return prev
        return { ...prev, [scopeKey]: filtered }
      })
      setAllActiveIds((prev) => {
        if (prev[scopeKey] !== DEV_SERVER_TERMINAL_ID) return prev
        const remaining = (allTerminals[scopeKey] || []).filter(
          (t) => t.id !== DEV_SERVER_TERMINAL_ID,
        )
        return {
          ...prev,
          [scopeKey]: remaining[remaining.length - 1]?.id ?? null,
        }
      })
    },
    onError: (err) => {
      console.warn("[useDevServer] stream error:", err)
    },
  })

  const command = detectQuery.data?.hasDevScript ? detectQuery.data.command : null
  const resolvedDir = detectQuery.data?.resolvedDir ?? cwd
  const canRun = !!detectQuery.data?.hasDevScript
  const isLoadingDetection = detectQuery.isLoading
  const detectReason = detectQuery.data?.reason ?? null
  const searchedPath = detectQuery.data?.searchedPath ?? null
  const availableScripts = detectQuery.data?.availableScripts ?? []

  const start = useCallback(async () => {
    if (!command || isRunning) return

    try {
      await createOrAttachMutation.mutateAsync({
        paneId,
        cwd: resolvedDir,
        workspaceId: chatId,
        scopeKey,
        initialCommands: [command],
      })

      // Add tab to the terminals atom (without initialCommands — those are
      // transient and were already passed to createOrAttach above).
      const newInstance: TerminalInstance = {
        id: DEV_SERVER_TERMINAL_ID,
        paneId,
        name: DEV_SERVER_TERMINAL_NAME,
        createdAt: Date.now(),
      }

      setAllTerminals((prev) => {
        const list = prev[scopeKey] || []
        if (list.some((t) => t.id === DEV_SERVER_TERMINAL_ID)) return prev
        return { ...prev, [scopeKey]: [...list, newInstance] }
      })
      setAllActiveIds((prev) => ({ ...prev, [scopeKey]: DEV_SERVER_TERMINAL_ID }))
      setSidebarOpen(true)
      setIsRunning(true)
    } catch (err) {
      console.error("[useDevServer] start failed:", err)
      toast.error(
        err instanceof Error
          ? `Failed to start dev server: ${err.message}`
          : "Failed to start dev server",
      )
    }
  }, [
    command,
    isRunning,
    paneId,
    cwd,
    chatId,
    scopeKey,
    createOrAttachMutation,
    setAllTerminals,
    setAllActiveIds,
    setSidebarOpen,
    setIsRunning,
  ])

  const removeTabRef = useRef<() => void>(() => {})
  removeTabRef.current = () => {
    setAllTerminals((prev) => {
      const list = prev[scopeKey]
      if (!list) return prev
      const filtered = list.filter((t) => t.id !== DEV_SERVER_TERMINAL_ID)
      if (filtered.length === list.length) return prev
      return { ...prev, [scopeKey]: filtered }
    })
    setAllActiveIds((prev) => {
      if (prev[scopeKey] !== DEV_SERVER_TERMINAL_ID) return prev
      const remaining = (allTerminals[scopeKey] || []).filter(
        (t) => t.id !== DEV_SERVER_TERMINAL_ID,
      )
      return {
        ...prev,
        [scopeKey]: remaining[remaining.length - 1]?.id ?? null,
      }
    })
  }

  const stop = useCallback(async () => {
    if (!isRunning) return

    try {
      // Graceful: SIGINT propagates to the foreground process group of the
      // shell — required to cleanly stop Vite/Next which spawn child processes
      // holding the port. Plain `kill` (SIGTERM on the shell) often orphans
      // those children.
      signalMutation.mutate({ paneId, signal: "SIGINT" })

      // Wait for the subscription's exit event to flip isRunning to false.
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, STOP_GRACE_PERIOD_MS)
        const id = setInterval(() => {
          // `isRunning` from closure is stale here; check the backend instead.
          trpcUtils.terminal.getSession
            .fetch(paneId)
            .then((session) => {
              const alive = !!session?.isAlive
              if (!alive) {
                clearTimeout(timeout)
                clearInterval(id)
                resolve()
              }
            })
            .catch(() => {})
        }, 200)
        // Always clear the interval if the timeout fires first
        setTimeout(() => clearInterval(id), STOP_GRACE_PERIOD_MS + 50)
      })

      // Force kill if still alive after the grace period
      const session = await trpcUtils.terminal.getSession.fetch(paneId)
      const stillAlive = !!session?.isAlive
      if (stillAlive) {
        await killMutation.mutateAsync({ paneId })
      }

      setIsRunning(false)
      removeTabRef.current()
    } catch (err) {
      console.error("[useDevServer] stop failed:", err)
      toast.error(
        err instanceof Error
          ? `Failed to stop dev server: ${err.message}`
          : "Failed to stop dev server",
      )
    }
  }, [isRunning, paneId, signalMutation, killMutation, trpcUtils, setIsRunning])

  return {
    canRun,
    isLoadingDetection,
    isRunning,
    command,
    start,
    stop,
    isStarting: createOrAttachMutation.isPending,
    isStopping: signalMutation.isPending || killMutation.isPending,
    detectReason,
    searchedPath,
    availableScripts,
    resolvedDir,
  }
}
