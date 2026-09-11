/**
 * mausCode useOpenclawLoginFlow: BYOK credential connect + verify.
 * Mirrors useClineLoginFlow (ours, NOT verbatim).
 *
 * OpenClaw onboarding persists keys as plaintext auth profiles by
 * default, so mausCode holds ONE encrypted credential instead and
 * injects it per-run via the spawn environment. Only providers
 * whose env-only run path was verified live are offered (OpenAI,
 * Anthropic, OpenRouter, xAI); local/custom endpoints need config
 * entries this path cannot supply (see the decision brief).
 */
import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { trpc, trpcClient } from "../../../lib/trpc"

export type OpenclawLoginFlowState = "idle" | "running" | "success" | "error" | "cancelled"

export type OpenclawAuthPreset = {
  id: string
  label: string
  provider: "openai" | "anthropic" | "openrouter" | "xai"
  /** Empty = CLI config default. */
  model: string
  keyPlaceholder: string
  /** Spawn-env variable the key is injected as (shown, never the key). */
  envVar: string
}

/** Provider ids with live-verified env-only `agent exec` runs. */
export const OPENCLAW_AUTH_PRESETS: OpenclawAuthPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    keyPlaceholder: "sk-...",
    envVar: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    model: "anthropic/claude-opus-5",
    keyPlaceholder: "sk-ant-...",
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    provider: "openrouter",
    model: "openrouter/auto",
    keyPlaceholder: "sk-or-...",
    envVar: "OPENROUTER_API_KEY",
  },
  {
    id: "xai",
    label: "xAI",
    provider: "xai",
    model: "xai/grok-4",
    keyPlaceholder: "xai-...",
    envVar: "XAI_API_KEY",
  },
]

const VERIFY_ATTEMPTS = 6
const VERIFY_DELAY_MS = 400

function isTerminalState(state: OpenclawLoginFlowState): boolean {
  return state === "success" || state === "error" || state === "cancelled"
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error
  }

  return fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function useOpenclawLoginFlow() {
  const [presetId, setPresetId] = useState<string>(OPENCLAW_AUTH_PRESETS[0].id)
  const [apiKey, setApiKey] = useState<string>("")
  const [model, setModel] = useState<string>(OPENCLAW_AUTH_PRESETS[0].model)
  const [state, setState] = useState<OpenclawLoginFlowState>("idle")
  const [detail, setDetail] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  // True when the modal opened over an already-connected backend: the
  // modal shows the connected panel (detail + Disconnect) instead of
  // auto-closing, since held credentials are mausCode-owned lifecycle.
  const [alreadyConnected, setAlreadyConnected] = useState<boolean>(false)

  const cancelledRef = useRef(false)
  const successToastRef = useRef(false)
  const lastErrorToastRef = useRef<string | null>(null)

  const saveMutation = trpc.openclaw.saveCredentials.useMutation()
  const testMutation = trpc.openclaw.testConnection.useMutation()
  const disconnectMutation = trpc.openclaw.disconnect.useMutation()
  const trpcUtils = trpc.useUtils()

  const preset =
    OPENCLAW_AUTH_PRESETS.find((candidate) => candidate.id === presetId) ?? OPENCLAW_AUTH_PRESETS[0]

  const notifyError = useCallback((message: string) => {
    if (lastErrorToastRef.current === message) {
      return
    }

    lastErrorToastRef.current = message
    toast.error(message)
  }, [])

  const verifyConnected = useCallback(async () => {
    let lastVerifyError: unknown = null

    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
      try {
        const integration = await trpcClient.openclaw.getIntegration.query()
        if (integration.isConnected) {
          await trpcUtils.openclaw.getIntegration.invalidate()
          setState("success")
          setError(null)
          if (!successToastRef.current) {
            successToastRef.current = true
            toast.success("OpenClaw connected successfully", { duration: 10000 })
          }
          return true
        }
      } catch (verifyError) {
        lastVerifyError = verifyError
      }

      if (attempt < VERIFY_ATTEMPTS - 1) {
        await sleep(VERIFY_DELAY_MS)
      }
    }

    const message = lastVerifyError
      ? toErrorMessage(
          lastVerifyError,
          "Failed to verify OpenClaw connection status. Please retry.",
        )
      : "OpenClaw credentials saved, but the connection was not detected. Please retry."

    setState("error")
    setError(message)
    notifyError(message)
    return false
  }, [notifyError, trpcUtils])

  const selectPreset = useCallback((nextPresetId: string) => {
    const next =
      OPENCLAW_AUTH_PRESETS.find((candidate) => candidate.id === nextPresetId) ??
      OPENCLAW_AUTH_PRESETS[0]
    setPresetId(next.id)
    setModel(next.model)
    setError(null)
  }, [])

  /**
   * Refresh from the backend when the modal opens: connected backends
   * show the connected panel, anything else shows the form. Typed form
   * values survive across opens (only the key is cleared after saving).
   */
  const initialize = useCallback(async () => {
    cancelledRef.current = false
    successToastRef.current = false
    lastErrorToastRef.current = null
    setAlreadyConnected(false)
    setState("idle")
    setError(null)
    setDetail("")
    try {
      const integration = await trpcClient.openclaw.getIntegration.query()
      if (integration.isConnected) {
        await trpcUtils.openclaw.getIntegration.invalidate()
        setAlreadyConnected(true)
        setState("success")
        setDetail(integration.rawOutput || "Already connected")
        return
      }
      setDetail(integration.rawOutput || "")
    } catch (initializeError) {
      setDetail(toErrorMessage(initializeError, ""))
    }
  }, [trpcUtils])

  const save = useCallback(async () => {
    if (saveMutation.isPending) return
    cancelledRef.current = false
    lastErrorToastRef.current = null
    setError(null)
    setState("running")

    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      const message = "Enter an API key to connect."
      setState("error")
      setError(message)
      notifyError(message)
      return
    }

    try {
      await saveMutation.mutateAsync({
        provider: preset.provider,
        apiKey: trimmedKey,
        ...(model.trim() ? { model: model.trim() } : {}),
        label: preset.label,
      })
      if (cancelledRef.current) return
      setApiKey("")
      await verifyConnected()
    } catch (saveError) {
      if (cancelledRef.current) return
      const message = toErrorMessage(
        saveError,
        "Failed to save OpenClaw credentials. Please try again.",
      )
      setState("error")
      setError(message)
      notifyError(message)
    }
  }, [apiKey, model, notifyError, preset.label, preset.provider, saveMutation, verifyConnected])

  const test = useCallback(async () => {
    if (testMutation.isPending) return
    try {
      const result = await testMutation.mutateAsync()
      setDetail(result.detail)
      if (result.ok) {
        toast.success("OpenClaw connection looks good", {
          description: result.detail,
        })
      } else {
        notifyError(result.detail || "OpenClaw connection check failed.")
      }
    } catch (testError) {
      notifyError(toErrorMessage(testError, "OpenClaw connection check failed."))
    }
  }, [notifyError, testMutation])

  const disconnect = useCallback(async () => {
    try {
      await disconnectMutation.mutateAsync()
      await trpcUtils.openclaw.getIntegration.invalidate()
      setAlreadyConnected(false)
      setState("idle")
      setError(null)
      setDetail("Disconnected. Ambient openclaw CLI config is untouched.")
      toast.success("OpenClaw disconnected")
    } catch (disconnectError) {
      notifyError(toErrorMessage(disconnectError, "Failed to disconnect OpenClaw."))
    }
  }, [disconnectMutation, notifyError, trpcUtils])

  const cancel = useCallback(() => {
    if (state === "success") return
    cancelledRef.current = true
    setState("cancelled")
  }, [state])

  /** Leave the connected panel for the credential form (replace flow). */
  const replaceCredentials = useCallback(() => {
    setAlreadyConnected(false)
    setState("idle")
    setError(null)
  }, [])

  return {
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
    isRunning: state === "running" || saveMutation.isPending,
    isTesting: testMutation.isPending,
    isDisconnecting: disconnectMutation.isPending,
    isTerminal: isTerminalState(state),
    save,
    test,
    disconnect,
    cancel,
    replaceCredentials,
  }
}
