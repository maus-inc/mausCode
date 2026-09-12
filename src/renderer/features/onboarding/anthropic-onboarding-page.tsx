"use client"

import { useSetAtom } from "jotai"
import { useEffect, useRef, useState } from "react"

import { ClaudeCodeIcon } from "../../components/ui/icons"
import { Logo } from "../../components/ui/logo"
import { anthropicOnboardingCompletedAtom, billingMethodAtom } from "../../lib/atoms"
import { trpc } from "../../lib/trpc"
import { OnboardingButton } from "./components/onboarding-button"
import { OnboardingCodeInput } from "./components/onboarding-code-input"
import { OnboardingError } from "./components/onboarding-error"
import { OnboardingHeader } from "./components/onboarding-header"
import { OnboardingShell } from "./components/onboarding-shell"

type AuthFlowState =
  | { step: "idle" }
  | { step: "starting" }
  | {
      step: "waiting_url"
      sandboxId: string
      sandboxUrl: string
      sessionId: string
    }
  | {
      step: "has_url"
      sandboxId: string
      oauthUrl: string
      sandboxUrl: string
      sessionId: string
    }
  | { step: "submitting" }
  | { step: "error"; message: string }

export function AnthropicOnboardingPage() {
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: "idle" })
  const [authCode, setAuthCode] = useState("")
  const [userClickedConnect, setUserClickedConnect] = useState(false)
  const [urlOpened, setUrlOpened] = useState(false)
  const [savedOauthUrl, setSavedOauthUrl] = useState<string | null>(null)
  const urlOpenedRef = useRef(false)
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)

  const handleBack = () => {
    setBillingMethod(null)
  }

  // tRPC mutations
  const startAuthMutation = trpc.claudeCode.startAuth.useMutation()
  const submitCodeMutation = trpc.claudeCode.submitCode.useMutation()
  const openOAuthUrlMutation = trpc.claudeCode.openOAuthUrl.useMutation()

  // Poll for OAuth URL
  const pollStatusQuery = trpc.claudeCode.pollStatus.useQuery(
    {
      sandboxUrl: flowState.step === "waiting_url" ? flowState.sandboxUrl : "",
      sessionId: flowState.step === "waiting_url" ? flowState.sessionId : "",
    },
    {
      enabled: flowState.step === "waiting_url",
      refetchInterval: 1500,
    },
  )

  // Auto-start auth on mount
  useEffect(() => {
    if (flowState.step === "idle") {
      setFlowState({ step: "starting" })
      startAuthMutation.mutate(undefined, {
        onSuccess: (result) => {
          setFlowState({
            step: "waiting_url",
            sandboxId: result.sandboxId,
            sandboxUrl: result.sandboxUrl,
            sessionId: result.sessionId,
          })
        },
        onError: (err) => {
          setFlowState({
            step: "error",
            message: err.message || "Failed to start authentication",
          })
        },
      })
    }
  }, [flowState.step, startAuthMutation])

  // Update flow state when we get the OAuth URL
  useEffect(() => {
    if (flowState.step === "waiting_url" && pollStatusQuery.data?.oauthUrl) {
      setSavedOauthUrl(pollStatusQuery.data.oauthUrl)
      setFlowState({
        step: "has_url",
        sandboxId: flowState.sandboxId,
        oauthUrl: pollStatusQuery.data.oauthUrl,
        sandboxUrl: flowState.sandboxUrl,
        sessionId: flowState.sessionId,
      })
    } else if (flowState.step === "waiting_url" && pollStatusQuery.data?.state === "error") {
      setFlowState({
        step: "error",
        message: pollStatusQuery.data.error || "Failed to get OAuth URL",
      })
    }
  }, [pollStatusQuery.data, flowState])

  // Open URL in browser when ready (after user clicked Connect)
  useEffect(() => {
    if (flowState.step === "has_url" && userClickedConnect && !urlOpenedRef.current) {
      urlOpenedRef.current = true
      setUrlOpened(true)
      // Use Electron's shell.openExternal via tRPC
      openOAuthUrlMutation.mutate(flowState.oauthUrl)
    }
  }, [flowState, userClickedConnect, openOAuthUrlMutation])

  // Check if the code looks like a valid Claude auth code (format: XXX#YYY)
  const isValidCodeFormat = (code: string) => {
    const trimmed = code.trim()
    return trimmed.length > 50 && trimmed.includes("#")
  }

  const handleConnectClick = async () => {
    setUserClickedConnect(true)

    if (flowState.step === "has_url") {
      // URL is ready, open it immediately
      urlOpenedRef.current = true
      setUrlOpened(true)
      openOAuthUrlMutation.mutate(flowState.oauthUrl)
    } else if (flowState.step === "error") {
      // Retry on error
      urlOpenedRef.current = false
      setUrlOpened(false)
      setFlowState({ step: "starting" })
      try {
        const result = await startAuthMutation.mutateAsync()
        setFlowState({
          step: "waiting_url",
          sandboxId: result.sandboxId,
          sandboxUrl: result.sandboxUrl,
          sessionId: result.sessionId,
        })
      } catch (err) {
        setFlowState({
          step: "error",
          message: err instanceof Error ? err.message : "Failed to start authentication",
        })
      }
    }
    // For idle, starting, waiting_url states - the useEffect will handle opening the URL
    // when it becomes ready (userClickedConnect is now true)
  }

  // Submit code - reusable for both auto-submit and manual Enter
  const submitCode = async (code: string) => {
    if (!code.trim() || flowState.step !== "has_url") return

    const { sandboxUrl, sessionId } = flowState
    setFlowState({ step: "submitting" })

    try {
      await submitCodeMutation.mutateAsync({
        sandboxUrl,
        sessionId,
        code: code.trim(),
      })
      // Success - mark onboarding as completed
      setAnthropicOnboardingCompleted(true)
    } catch (err) {
      setFlowState({
        step: "error",
        message: err instanceof Error ? err.message : "Failed to submit code",
      })
    }
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setAuthCode(value)

    // Auto-submit if the pasted value looks like a valid auth code
    if (isValidCodeFormat(value) && flowState.step === "has_url") {
      // Small delay to let the UI update before submitting
      setTimeout(() => submitCode(value), 100)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && authCode.trim()) {
      submitCode(authCode)
    }
  }

  const handleOpenFallbackUrl = () => {
    if (savedOauthUrl) {
      openOAuthUrlMutation.mutate(savedOauthUrl)
    }
  }

  const isLoadingAuth = flowState.step === "starting" || flowState.step === "waiting_url"
  const isSubmitting = flowState.step === "submitting"

  return (
    <OnboardingShell onBack={handleBack}>
      <OnboardingHeader
        icon={
          <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <Logo className="w-5 h-5 invert" />
            </div>
            <div className="w-10 h-10 rounded-full bg-[#D97757] flex items-center justify-center">
              <ClaudeCodeIcon className="w-6 h-6 text-white" />
            </div>
          </div>
        }
        title="Connect Claude Code"
        subtitle="Connect your Claude Code subscription to get started"
      />

      {/* Content */}
      <div className="space-y-6 flex flex-col items-center">
        {/* Connect Button - shows loader only if user clicked AND loading */}
        {!urlOpened && flowState.step !== "has_url" && flowState.step !== "error" && (
          <OnboardingButton
            onClick={handleConnectClick}
            disabled={userClickedConnect && isLoadingAuth}
            loading={userClickedConnect && isLoadingAuth}
            className="px-4 min-w-[85px]"
          >
            Connect
          </OnboardingButton>
        )}

        {/* Code Input - Show after URL is opened, if has_url (after redirect), or if submitting */}
        {/* No Continue button - auto-submit on valid code paste */}
        {(urlOpened || flowState.step === "has_url" || flowState.step === "submitting") && (
          <div className="space-y-4">
            <OnboardingCodeInput
              value={authCode}
              onChange={handleCodeChange}
              onKeyDown={handleKeyDown}
              placeholder="Paste your authentication code here..."
              busy={isSubmitting}
            />
            <p className="text-xs text-muted-foreground text-center">
              A new tab has opened for authentication.
              {savedOauthUrl && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={handleOpenFallbackUrl}
                    className="text-primary hover:underline"
                  >
                    Didn't open? Click here
                  </button>
                </>
              )}
            </p>
          </div>
        )}

        {/* Error State */}
        {flowState.step === "error" && (
          <OnboardingError message={flowState.message} onRetry={handleConnectClick} />
        )}
      </div>
    </OnboardingShell>
  )
}
