"use client"

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useEffect, useState } from "react"

import { KeyFilledIcon, SettingsFilledIcon } from "../../components/ui/icons"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import { Logo } from "../../components/ui/logo"
import {
  apiKeyOnboardingCompletedAtom,
  billingMethodAtom,
  type CustomClaudeConfig,
  customClaudeConfigAtom,
} from "../../lib/atoms"
import { OnboardingButton } from "./components/onboarding-button"
import { OnboardingCodeInput } from "./components/onboarding-code-input"
import { OnboardingHeader } from "./components/onboarding-header"
import { OnboardingShell } from "./components/onboarding-shell"

// Check if the key looks like a valid Anthropic API key
const isValidApiKey = (key: string) => {
  const trimmed = key.trim()
  return trimmed.startsWith("sk-ant-") && trimmed.length > 20
}

export function ApiKeyOnboardingPage() {
  const [storedConfig, setStoredConfig] = useAtom(customClaudeConfigAtom)
  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)

  const isCustomModel = billingMethod === "custom-model"

  // Default values for API key mode (not custom model)
  const defaultModel = "claude-sonnet-4-6"
  const defaultBaseUrl = "https://api.anthropic.com"

  const [apiKey, setApiKey] = useState(storedConfig.token)
  const [model, setModel] = useState(storedConfig.model || "")
  const [token, setToken] = useState(storedConfig.token)
  const [baseUrl, setBaseUrl] = useState(storedConfig.baseUrl || "")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Sync from stored config on mount
  useEffect(() => {
    if (storedConfig.token) {
      setApiKey(storedConfig.token)
      setToken(storedConfig.token)
    }
    if (storedConfig.model) setModel(storedConfig.model)
    if (storedConfig.baseUrl) setBaseUrl(storedConfig.baseUrl)
  }, [])

  const handleBack = () => {
    setBillingMethod(null)
  }

  // Submit for API key mode (simple - just the key)
  const submitApiKey = (key: string) => {
    if (!isValidApiKey(key)) return

    setIsSubmitting(true)

    const config: CustomClaudeConfig = {
      model: defaultModel,
      token: key.trim(),
      baseUrl: defaultBaseUrl,
    }
    setStoredConfig(config)
    setApiKeyOnboardingCompleted(true)

    setIsSubmitting(false)
  }

  // Submit for custom model mode (all three fields)
  const submitCustomModel = () => {
    const trimmedModel = model.trim()
    const trimmedToken = token.trim()
    const trimmedBaseUrl = baseUrl.trim()

    if (!trimmedModel || !trimmedToken || !trimmedBaseUrl) return

    setIsSubmitting(true)

    const config: CustomClaudeConfig = {
      model: trimmedModel,
      token: trimmedToken,
      baseUrl: trimmedBaseUrl,
    }
    setStoredConfig(config)
    setApiKeyOnboardingCompleted(true)

    setIsSubmitting(false)
  }

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setApiKey(value)

    // Auto-submit if valid API key is pasted
    if (isValidApiKey(value)) {
      setTimeout(() => submitApiKey(value), 100)
    }
  }

  const handleApiKeyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && apiKey.trim()) {
      submitApiKey(apiKey)
    }
  }

  const canSubmitCustomModel = Boolean(model.trim() && token.trim() && baseUrl.trim())

  // Simple API key input mode
  if (!isCustomModel) {
    return (
      <OnboardingShell onBack={handleBack}>
        <OnboardingHeader
          icon={
            <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Logo className="w-5 h-5 invert" />
              </div>
              <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
                <KeyFilledIcon className="w-5 h-5 text-background" />
              </div>
            </div>
          }
          title="Enter API Key"
          subtitle={
            <>
              Get your API key from{" "}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:underline"
              >
                console.anthropic.com
              </a>
            </>
          }
        />

        {/* API Key Input */}
        <div className="space-y-4">
          <OnboardingCodeInput
            value={apiKey}
            onChange={handleApiKeyChange}
            onKeyDown={handleApiKeyKeyDown}
            placeholder="sk-ant-..."
            busy={isSubmitting}
          />
          <p className="text-xs text-muted-foreground text-center">
            Your API key starts with sk-ant-
          </p>
        </div>
      </OnboardingShell>
    )
  }

  // Custom model mode with all fields
  return (
    <OnboardingShell onBack={handleBack}>
      <OnboardingHeader
        icon={
          <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <Logo className="w-5 h-5 invert" />
            </div>
            <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
              <SettingsFilledIcon className="w-5 h-5 text-background" />
            </div>
          </div>
        }
        title="Configure Custom Model"
        subtitle="Enter your custom model configuration"
      />

      {/* Form Fields */}
      <div className="space-y-4">
        {/* Model Name */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Model name</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="claude-sonnet-4-6"
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">Model identifier for API requests</p>
        </div>

        {/* API Token */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">API token</Label>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">Your API key or token</p>
        </div>

        {/* Base URL */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Base URL</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.anthropic.com"
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">API endpoint URL</p>
        </div>
      </div>

      <OnboardingButton
        onClick={submitCustomModel}
        disabled={!canSubmitCustomModel || isSubmitting}
        loading={isSubmitting}
        className="w-full px-3"
      >
        Continue
      </OnboardingButton>
    </OnboardingShell>
  )
}
