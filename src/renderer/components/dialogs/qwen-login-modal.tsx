/**
 * mausCode QwenLoginModal shell (auth-retry aware). Mirrors CursorLoginModal (ours, NOT verbatim).
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
import { QwenLoginContent } from "../../features/agents/components/qwen-login-content"
import { useQwenLoginFlow } from "../../features/agents/hooks/use-qwen-login-flow"
import { qwenLoginModalOpenAtom } from "../../lib/atoms"
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "../ui/alert-dialog"

export function QwenLoginModal() {
  const [open, setOpen] = useAtom(qwenLoginModalOpenAtom)
  const [pendingAuthRetry, setPendingAuthRetry] = useAtom(pendingAuthRetryMessageAtom)
  const didInitForOpenRef = useRef(false)

  const {
    initialize,
    preset,
    presetId,
    selectPreset,
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
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
  } = useQwenLoginFlow()

  const clearPendingRetryIfNeeded = () => {
    if (
      pendingAuthRetry &&
      pendingAuthRetry.provider === "qwen" &&
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

    if (pendingAuthRetry?.provider === "qwen" && !pendingAuthRetry.readyToRetry) {
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

        <QwenLoginContent
          state={state}
          error={error}
          detail={detail}
          alreadyConnected={alreadyConnected}
          preset={preset}
          presetId={presetId}
          onSelectPreset={selectPreset}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          baseUrl={baseUrl}
          onBaseUrlChange={setBaseUrl}
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
