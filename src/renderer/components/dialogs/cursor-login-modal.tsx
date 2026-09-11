/**
 * NOTE (transplant): CursorLoginModal shell (auth-retry aware).
 * Source: SamSammane/1code-ui (Apache-2.0), commit 51b79a5.
 */
"use client"

import { useAtom, useSetAtom } from "jotai"
import { X } from "lucide-react"
import { useEffect, useRef } from "react"
import { pendingAuthRetryMessageAtom } from "../../features/agents/atoms"
import { CursorLoginContent } from "../../features/agents/components/cursor-login-content"
import { useCursorLoginFlow } from "../../features/agents/hooks/use-cursor-login-flow"
import { cursorLoginModalOpenAtom } from "../../lib/atoms"
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "../ui/alert-dialog"

type CursorLoginModalProps = {
  autoStart?: boolean
}

export function CursorLoginModal({ autoStart = true }: CursorLoginModalProps) {
  const [open, setOpen] = useAtom(cursorLoginModalOpenAtom)
  const [pendingAuthRetry, setPendingAuthRetry] = useAtom(pendingAuthRetryMessageAtom)
  const didInitForOpenRef = useRef(false)
  const didStartForOpenRef = useRef(false)
  const shouldAutoOpenUrlRef = useRef(false)
  const isAuthRetryFlow = pendingAuthRetry?.provider === "cursor"
  const shouldAutoStartForCurrentFlow = autoStart && !isAuthRetryFlow

  const { state, url, error, isRunning, isOpeningUrl, start, cancel, reset, openUrl } =
    useCursorLoginFlow()

  const clearPendingRetryIfNeeded = () => {
    if (
      pendingAuthRetry &&
      pendingAuthRetry.provider === "cursor" &&
      !pendingAuthRetry.readyToRetry
    ) {
      setPendingAuthRetry(null)
    }
  }

  useEffect(() => {
    if (!open) {
      didInitForOpenRef.current = false
      didStartForOpenRef.current = false
      shouldAutoOpenUrlRef.current = false
      return
    }

    if (!didInitForOpenRef.current) {
      didInitForOpenRef.current = true
      reset()
    }

    if (!shouldAutoStartForCurrentFlow) {
      return
    }

    if (didStartForOpenRef.current) {
      return
    }

    didStartForOpenRef.current = true
    void start()
  }, [open, reset, shouldAutoStartForCurrentFlow, start])

  useEffect(() => {
    if (!open) {
      shouldAutoOpenUrlRef.current = false
      return
    }

    if (!shouldAutoOpenUrlRef.current) {
      return
    }

    if (url) {
      shouldAutoOpenUrlRef.current = false
      void openUrl()
      return
    }

    if (state === "error" || state === "cancelled" || state === "success") {
      shouldAutoOpenUrlRef.current = false
    }
  }, [open, openUrl, state, url])

  useEffect(() => {
    if (!open || state !== "success") return

    if (pendingAuthRetry?.provider === "cursor" && !pendingAuthRetry.readyToRetry) {
      setPendingAuthRetry({ ...pendingAuthRetry, readyToRetry: true })
    }

    setOpen(false)
  }, [open, pendingAuthRetry, setOpen, setPendingAuthRetry, state])

  const handleConnect = () => {
    shouldAutoOpenUrlRef.current = true
    void start()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      void cancel()
      clearPendingRetryIfNeeded()
    }
    setOpen(nextOpen)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[380px] p-6">
        <AlertDialogCancel className="absolute right-4 top-4 h-6 w-6 p-0 border-0 bg-transparent hover:bg-muted rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </AlertDialogCancel>

        <CursorLoginContent
          state={state}
          error={error}
          url={url}
          isOpeningUrl={isOpeningUrl}
          showConnectButton={!shouldAutoStartForCurrentFlow}
          isConnecting={isRunning || isOpeningUrl}
          onConnect={handleConnect}
          onOpenUrl={() => {
            void openUrl()
          }}
          onRetry={() => {
            if (shouldAutoStartForCurrentFlow) {
              void start()
              return
            }

            handleConnect()
          }}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
