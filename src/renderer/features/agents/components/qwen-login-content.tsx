/**
 * mausCode Qwen connect dialog content. Mirrors CursorLoginContent (ours, NOT verbatim).
 *
 * Upstream removed `qwen auth`, so instead of a browser flow this is a
 * credential form: endpoint preset + API key + model, stored encrypted
 * in the app DB and injected per-run via CLI flags (the user's
 * ~/.qwen/settings.json is never written). Header/footer structure
 * mirrors the sibling login contents.
 */
"use client"

import { Button } from "../../../components/ui/button"
import { QwenIcon } from "../../../components/ui/icons"
import { Input } from "../../../components/ui/input"
import { Label } from "../../../components/ui/label"
import { Logo } from "../../../components/ui/logo"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select"
import {
  QWEN_AUTH_PRESETS,
  type QwenAuthPreset,
  type QwenLoginFlowState,
} from "../hooks/use-qwen-login-flow"

type QwenLoginContentProps = {
  state: QwenLoginFlowState
  error: string | null
  detail: string
  alreadyConnected: boolean
  preset: QwenAuthPreset
  presetId: string
  onSelectPreset: (presetId: string) => void
  apiKey: string
  onApiKeyChange: (value: string) => void
  baseUrl: string
  onBaseUrlChange: (value: string) => void
  model: string
  onModelChange: (value: string) => void
  isRunning: boolean
  isTesting: boolean
  isDisconnecting: boolean
  onConnect: () => void
  onTest: () => void
  onDisconnect: () => void
  onReplace: () => void
}

export function QwenLoginContent({
  state,
  error,
  detail,
  alreadyConnected,
  preset,
  presetId,
  onSelectPreset,
  apiKey,
  onApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  model,
  onModelChange,
  isRunning,
  isTesting,
  isDisconnecting,
  onConnect,
  onTest,
  onDisconnect,
  onReplace,
}: QwenLoginContentProps) {
  const showConnectedPanel = alreadyConnected && state === "success"
  const formDisabled = isRunning || showConnectedPanel

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <Logo className="w-5 h-5 invert" />
          </div>
          <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
            <QwenIcon className="w-6 h-6 text-background" />
          </div>
        </div>
        <div className="space-y-1">
          <h1 className="text-base font-semibold tracking-tight">Connect Qwen Code</h1>
          <p className="text-sm text-muted-foreground">
            {showConnectedPanel
              ? "Qwen Code is connected"
              : "Connect with an API key to use the Qwen Code agent"}
          </p>
        </div>
      </div>

      {showConnectedPanel ? (
        <div className="space-y-6">
          {detail && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap break-all">{detail}</p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onReplace} className="flex-1">
              Replace credentials
            </Button>
            <Button
              variant="destructive"
              onClick={onDisconnect}
              disabled={isDisconnecting}
              className="flex-1"
            >
              {isDisconnecting ? "Disconnecting..." : "Disconnect"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-4 text-left">
            <div className="space-y-2">
              <Label htmlFor="qwen-preset">Provider</Label>
              <Select value={presetId} onValueChange={onSelectPreset} disabled={formDisabled}>
                <SelectTrigger id="qwen-preset">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {QWEN_AUTH_PRESETS.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qwen-key">API key</Label>
              <Input
                id="qwen-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={preset.keyPlaceholder}
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                disabled={formDisabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qwen-base-url">Base URL</Label>
              <Input
                id="qwen-base-url"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://..."
                value={baseUrl}
                onChange={(event) => onBaseUrlChange(event.target.value)}
                disabled={formDisabled || presetId !== "custom"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qwen-model">Model</Label>
              <Input
                id="qwen-model"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="qwen3-coder-plus"
                value={model}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={formDisabled}
              />
            </div>
          </div>

          {detail && !error && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap break-all">{detail}</p>
          )}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={onTest}
              disabled={isRunning || isTesting}
              className="flex-1"
            >
              {isTesting ? "Checking..." : "Test"}
            </Button>
            <Button
              onClick={onConnect}
              disabled={formDisabled || apiKey.trim().length === 0}
              className="flex-1"
            >
              {isRunning ? "Connecting..." : "Connect"}
            </Button>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The key is stored encrypted on this device and passed to the qwen CLI per run. Your qwen
            CLI config files are never modified.
          </p>
        </div>
      )}
    </div>
  )
}
