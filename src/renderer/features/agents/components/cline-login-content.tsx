/**
 * mausCode Cline connect dialog content. Mirrors QwenLoginContent (ours, NOT verbatim).
 *
 * Instead of a browser flow this is a credential form: provider preset
 * + API key + model, stored encrypted in the app DB and injected
 * per-run via -P/-k/-m flags (the user's ~/.cline files are never
 * written — upstream stores keys in plaintext). Local runtimes
 * (Ollama/LM Studio) take no key. Header/footer structure mirrors
 * the sibling login contents.
 */
"use client"

import { Button } from "../../../components/ui/button"
import { ClineIcon } from "../../../components/ui/icons"
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
  CLINE_AUTH_PRESETS,
  type ClineAuthPreset,
  type ClineLoginFlowState,
} from "../hooks/use-cline-login-flow"

type ClineLoginContentProps = {
  state: ClineLoginFlowState
  error: string | null
  detail: string
  alreadyConnected: boolean
  preset: ClineAuthPreset
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

export function ClineLoginContent({
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
}: ClineLoginContentProps) {
  const showConnectedPanel = alreadyConnected && state === "success"
  const formDisabled = isRunning || showConnectedPanel
  // Keyless presets (Ollama/LM Studio) connect with no key; custom
  // presets additionally require the endpoint URL.
  const canConnect =
    !formDisabled &&
    (!preset.keyRequired || apiKey.trim().length > 0) &&
    (preset.lockBaseUrl || baseUrl.trim().length > 0)

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <Logo className="w-5 h-5 invert" />
          </div>
          <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
            <ClineIcon className="w-6 h-6 text-background" />
          </div>
        </div>
        <div className="space-y-1">
          <h1 className="text-base font-semibold tracking-tight">Connect Cline</h1>
          <p className="text-sm text-muted-foreground">
            {showConnectedPanel
              ? "Cline is connected"
              : "Connect with a provider key to use the Cline agent"}
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
              <Label htmlFor="cline-preset">Provider</Label>
              <Select value={presetId} onValueChange={onSelectPreset} disabled={formDisabled}>
                <SelectTrigger id="cline-preset">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {CLINE_AUTH_PRESETS.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {preset.keyRequired && (
              <div className="space-y-2">
                <Label htmlFor="cline-key">API key</Label>
                <Input
                  id="cline-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={preset.keyPlaceholder}
                  value={apiKey}
                  onChange={(event) => onApiKeyChange(event.target.value)}
                  disabled={formDisabled}
                />
              </div>
            )}

            {(!preset.lockBaseUrl || preset.baseUrl) && (
              <div className="space-y-2">
                <Label htmlFor="cline-base-url">Base URL</Label>
                <Input
                  id="cline-base-url"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://..."
                  value={baseUrl}
                  onChange={(event) => onBaseUrlChange(event.target.value)}
                  disabled={formDisabled || preset.lockBaseUrl}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="cline-model">Model</Label>
              <Input
                id="cline-model"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Provider default"
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
            <Button onClick={onConnect} disabled={!canConnect} className="flex-1">
              {isRunning ? "Connecting..." : "Connect"}
            </Button>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The key is stored encrypted on this device and passed to the cline CLI per run. Your
            cline CLI config files are never modified.
          </p>
        </div>
      )}
    </div>
  )
}
