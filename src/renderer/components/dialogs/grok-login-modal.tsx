/**
 * mausCode GrokLoginModal shell (auth-retry aware). Mirrors CursorLoginModal (ours, NOT verbatim).
 */
"use client"

import { useAtom, useSetAtom } from "jotai"
import { X } from "lucide-react"
import { useEffect, useRef } from "react"
import { pendingAuthRetryMessageAtom } from "../../features/agents/atoms"
import { GrokLoginContent } from "../../features/agents/components/grok-login-content"
import { useGrokLoginFlow } from "../../features/agents/hooks/use-grok-login-flow"
import { grokLoginModalOpenAtom } from "../../lib/atoms"
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "../ui/alert-dialog"

type GrokLoginModalProps = {
  autoStart?: boolean
}

export function GrokLoginModal({ autoStart = true }: GrokLoginModalProps) {
  const [open, setOpen] = useAtom(grokLoginModalOpenAtom)
  const [pendingAuthRetry, setPendingAuthRetry] = useAtom(pendingAuthRetryMessageAtom)
  const didInitForOpenRef = useRef(false)
  const didStartForOpenRef = useRef(false)
  const shouldAutoOpenUrlRef = useRef(false)
  const isAuthRetryFlow = pendingAuthRetry?.provider === "grok"
  const shouldAutoStartForCurrentFlow = autoStart && !isAuthRetryFlow

  const { state, url, code, error, isRunning, isOpeningUrl, start, cancel, reset, openUrl } =
    useGrokLoginFlow()

  const clearPendingRetryIfNeeded = () => {
    if (
      pendingAuthRetry &&
      pendingAuthRetry.provider === "grok" &&
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

    if (pendingAuthRetry?.provider === "grok" && !pendingAuthRetry.readyToRetry) {
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

        <GrokLoginContent
          state={state}
          error={error}
          url={url}
          code={code}
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
