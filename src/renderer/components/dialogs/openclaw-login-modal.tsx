/**
 * mausCode OpenclawLoginModal shell (auth-retry aware). Mirrors ClineLoginModal (ours, NOT verbatim).
 *
 * Unlike the browser-flow siblings there is nothing to auto-start: the
 * hook verifies existing state on mount and the user fills the
 * credential form. Fresh-save success flips pending auth-retries and
 * closes; opening over an already-connected backend shows the
 * connected panel instead of auto-closing.
 */
"use client"

import { useAtom } from "jotai"
import { X } from "lucide-react"
import { useEffect, useRef } from "react"
import { pendingAuthRetryMessageAtom } from "../../features/agents/atoms"
import { OpenclawLoginContent } from "../../features/agents/components/openclaw-login-content"
import { useOpenclawLoginFlow } from "../../features/agents/hooks/use-openclaw-login-flow"
import { openclawLoginModalOpenAtom } from "../../lib/atoms"
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "../ui/alert-dialog"

export function OpenclawLoginModal() {
  const [open, setOpen] = useAtom(openclawLoginModalOpenAtom)
  const [pendingAuthRetry, setPendingAuthRetry] = useAtom(pendingAuthRetryMessageAtom)
  const didInitForOpenRef = useRef(false)

  const {
    initialize,
    preset,
    presetId,
    selectPreset,
    apiKey,
    setApiKey,
    model,
    setModel,
    state,
    detail,
    error,
    alreadyConnected,
    isRunning,
    isTesting,
    isDisconnecting,
    save,
    test,
    disconnect,
    cancel,
    replaceCredentials,
  } = useOpenclawLoginFlow()

  const clearPendingRetryIfNeeded = () => {
    if (
      pendingAuthRetry &&
      pendingAuthRetry.provider === "openclaw" &&
      !pendingAuthRetry.readyToRetry
    ) {
      setPendingAuthRetry(null)
    }
  }

  useEffect(() => {
    if (!open) {
      didInitForOpenRef.current = false
      return
    }

    if (!didInitForOpenRef.current) {
      didInitForOpenRef.current = true
      void initialize()
    }
  }, [open, initialize])

  useEffect(() => {
    if (!open || state !== "success" || alreadyConnected) return

    if (pendingAuthRetry?.provider === "openclaw" && !pendingAuthRetry.readyToRetry) {
      setPendingAuthRetry({ ...pendingAuthRetry, readyToRetry: true })
    }

    setOpen(false)
  }, [open, pendingAuthRetry, setOpen, setPendingAuthRetry, state, alreadyConnected])

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

        <OpenclawLoginContent
          state={state}
          error={error}
          detail={detail}
          alreadyConnected={alreadyConnected}
          preset={preset}
          presetId={presetId}
          onSelectPreset={selectPreset}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          model={model}
          onModelChange={setModel}
          isRunning={isRunning}
          isTesting={isTesting}
          isDisconnecting={isDisconnecting}
          onConnect={() => {
            void save()
          }}
          onTest={() => {
            void test()
          }}
          onDisconnect={() => {
            void disconnect()
          }}
          onReplace={replaceCredentials}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
