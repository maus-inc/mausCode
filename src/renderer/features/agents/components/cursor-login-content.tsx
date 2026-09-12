/**
 * NOTE (transplant): Cursor login dialog content.
 * Source: SamSammane/1code-ui (Apache-2.0), commit 51b79a5.
 */
"use client"

import { Button } from "../../../components/ui/button"
import { CursorIcon } from "../../../components/ui/icons"
import { Logo } from "../../../components/ui/logo"
import type { CursorLoginFlowState } from "../hooks/use-cursor-login-flow"

type CursorLoginContentProps = {
  state: CursorLoginFlowState
  error: string | null
  url: string | null
  isOpeningUrl: boolean
  showConnectButton?: boolean
  isConnecting?: boolean
  onConnect?: () => void
  onOpenUrl: () => void
  onRetry: () => void
}

export function CursorLoginContent({
  state,
  error,
  url,
  isOpeningUrl,
  showConnectButton = false,
  isConnecting = false,
  onConnect,
  onOpenUrl,
  onRetry,
}: CursorLoginContentProps) {
  const showRetry = state === "error" || state === "cancelled"
  const showConnect = showConnectButton && state === "idle"
  const showFooter = Boolean(error) || showRetry || showConnect

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <Logo className="w-5 h-5" />
          </div>
          <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
            <CursorIcon className="w-6 h-6 text-background" />
          </div>
        </div>
        <div className="space-y-1">
          <h1 className="text-base font-semibold tracking-tight">Connect Cursor CLI</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with your Cursor account to use the CLI agent
          </p>

          {url && (
            <p className="text-xs text-muted-foreground">
              <button
                type="button"
                onClick={onOpenUrl}
                disabled={isOpeningUrl}
                className="text-primary hover:underline disabled:opacity-50"
              >
                {isOpeningUrl ? "Opening..." : "Didn't open? Click here"}
              </button>
            </p>
          )}
        </div>
      </div>

      {showFooter && (
        <div className="space-y-6">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {showRetry && (
            <Button variant="secondary" onClick={onRetry} className="w-full">
              Retry
            </Button>
          )}

          {showConnect && (
            <Button onClick={onConnect} disabled={!onConnect || isConnecting} className="w-full">
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
