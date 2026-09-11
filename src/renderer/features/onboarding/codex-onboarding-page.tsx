"use client"

import { useAtomValue, useSetAtom } from "jotai"
import { useEffect, useMemo, useRef } from "react"
import {
  billingMethodAtom,
  codexOnboardingAuthMethodAtom,
  codexOnboardingCompletedAtom,
} from "../../lib/atoms"
import { CodexLoginContent } from "../agents/components/codex-login-content"
import { useCodexLoginFlow } from "../agents/hooks/use-codex-login-flow"
import { OnboardingShell } from "./components/onboarding-shell"

export function CodexOnboardingPage() {
  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const setCodexOnboardingCompleted = useSetAtom(codexOnboardingCompletedAtom)
  const setCodexOnboardingAuthMethod = useSetAtom(codexOnboardingAuthMethodAtom)
  const didAutoStartRef = useRef(false)
  const onboardingMethod = useMemo(() => {
    if (billingMethod === "codex-api-key") return "api_key"
    return "chatgpt"
  }, [billingMethod])

  const {
    state,
    method,
    apiKeyInput,
    url,
    error,
    isRunning,
    isOpeningUrl,
    start,
    saveApiKey,
    setMethod,
    setApiKeyInput,
    cancel,
    openUrl,
  } = useCodexLoginFlow()

  useEffect(() => {
    setMethod(onboardingMethod)
  }, [onboardingMethod, setMethod])

  useEffect(() => {
    if (onboardingMethod !== "chatgpt") {
      return
    }

    // Wait until flow state reflects selected onboarding method to avoid
    // triggering OAuth from the default "chatgpt" value on first render.
    if (method !== onboardingMethod) {
      return
    }

    if (didAutoStartRef.current) {
      return
    }

    didAutoStartRef.current = true
    void start()
  }, [method, onboardingMethod, start])

  useEffect(() => {
    if (state === "success") {
      setCodexOnboardingCompleted(true)
      setCodexOnboardingAuthMethod(method)
    }
  }, [method, setCodexOnboardingAuthMethod, setCodexOnboardingCompleted, state])

  const handleBack = async () => {
    if (isRunning) {
      await cancel()
    }
    setBillingMethod(null)
  }

  return (
    <OnboardingShell onBack={handleBack}>
      <CodexLoginContent
        state={state}
        method={method}
        apiKey={apiKeyInput}
        error={error}
        url={url}
        isOpeningUrl={isOpeningUrl}
        isConnecting={isRunning || isOpeningUrl}
        onOpenUrl={() => {
          void openUrl()
        }}
        onRetry={() => {
          void start()
        }}
        onApiKeyChange={setApiKeyInput}
        onSubmitApiKey={() => {
          void saveApiKey()
        }}
      />
    </OnboardingShell>
  )
}
