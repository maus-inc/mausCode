/**
 * mausCode useRooLoginFlow: BYOK credential connect + verify.
 * Mirrors useClineLoginFlow (ours, NOT verbatim).
 *
 * mausCode holds ONE encrypted credential instead of writing the
 * user's CLI config, and injects it per-run via the spawn
 * environment. Only the five CLI-supported providers are offered
 * (Anthropic, OpenAI native, Gemini, OpenRouter, Vercel AI Gateway);
 * anything else needs extension config entries this path cannot
 * supply (see the decision brief).
 */
import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { trpc, trpcClient } from "../../../lib/trpc"

export type RooLoginFlowState = "idle" | "running" | "success" | "error" | "cancelled"

export type RooAuthPreset = {
  id: string
  label: string
  provider: "anthropic" | "openai-native" | "gemini" | "openrouter" | "vercel-ai-gateway"
  /** Empty = upstream default chain. */
  model: string
  keyPlaceholder: string
  /** Spawn-env variable the key is injected as (shown, never the key). */
  envVar: string
}

/** Provider ids with source-verified env-only `roo -p` runs. */
export const ROO_AUTH_PRESETS: RooAuthPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.5",
    keyPlaceholder: "sk-or-...",
    envVar: "OPENROUTER_API_KEY",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    keyPlaceholder: "sk-ant-...",
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai-native",
    label: "OpenAI",
    provider: "openai-native",
    model: "gpt-5.1-codex-max",
    keyPlaceholder: "sk-...",
    envVar: "OPENAI_API_KEY",
  },
  {
    id: "gemini",
    label: "Gemini",
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    keyPlaceholder: "AIza-...",
    envVar: "GOOGLE_API_KEY",
  },
  {
    id: "vercel-ai-gateway",
    label: "Vercel AI Gateway",
    provider: "vercel-ai-gateway",
    model: "anthropic/claude-sonnet-4",
    keyPlaceholder: "vck_...",
    envVar: "VERCEL_AI_GATEWAY_API_KEY",
  },
]

const VERIFY_ATTEMPTS = 6
const VERIFY_DELAY_MS = 400

function isTerminalState(state: RooLoginFlowState): boolean {
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

export function useRooLoginFlow() {
  const [presetId, setPresetId] = useState<string>(ROO_AUTH_PRESETS[0].id)
  const [apiKey, setApiKey] = useState<string>("")
  const [model, setModel] = useState<string>(ROO_AUTH_PRESETS[0].model)
  const [state, setState] = useState<RooLoginFlowState>("idle")
  const [detail, setDetail] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  // True when the modal opened over an already-connected backend: the
  // modal shows the connected panel (detail + Disconnect) instead of
  // auto-closing, since held credentials are mausCode-owned lifecycle.
  const [alreadyConnected, setAlreadyConnected] = useState<boolean>(false)

  const cancelledRef = useRef(false)
  const successToastRef = useRef(false)
  const lastErrorToastRef = useRef<string | null>(null)

  const saveMutation = trpc.roo.saveCredentials.useMutation()
  const testMutation = trpc.roo.testConnection.useMutation()
  const disconnectMutation = trpc.roo.disconnect.useMutation()
  const trpcUtils = trpc.useUtils()

  const preset =
    ROO_AUTH_PRESETS.find((candidate) => candidate.id === presetId) ?? ROO_AUTH_PRESETS[0]

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
        const integration = await trpcClient.roo.getIntegration.query()
        if (integration.isConnected) {
          await trpcUtils.roo.getIntegration.invalidate()
          setState("success")
          setError(null)
          if (!successToastRef.current) {
            successToastRef.current = true
            toast.success("Roo Code connected successfully", { duration: 10000 })
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
          "Failed to verify Roo Code connection status. Please retry.",
        )
      : "Roo Code credentials saved, but the connection was not detected. Please retry."

    setState("error")
    setError(message)
    notifyError(message)
    return false
  }, [notifyError, trpcUtils])

  const selectPreset = useCallback((nextPresetId: string) => {
    const next =
      ROO_AUTH_PRESETS.find((candidate) => candidate.id === nextPresetId) ?? ROO_AUTH_PRESETS[0]
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
      const integration = await trpcClient.roo.getIntegration.query()
      if (integration.isConnected) {
        await trpcUtils.roo.getIntegration.invalidate()
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
        "Failed to save Roo Code credentials. Please try again.",
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
        toast.success("Roo Code connection looks good", {
          description: result.detail,
        })
      } else {
        notifyError(result.detail || "Roo Code connection check failed.")
      }
    } catch (testError) {
      notifyError(toErrorMessage(testError, "Roo Code connection check failed."))
    }
  }, [notifyError, testMutation])

  const disconnect = useCallback(async () => {
    try {
      await disconnectMutation.mutateAsync()
      await trpcUtils.roo.getIntegration.invalidate()
      setAlreadyConnected(false)
      setState("idle")
      setError(null)
      setDetail("Disconnected. Ambient roo CLI config is untouched.")
      toast.success("Roo Code disconnected")
    } catch (disconnectError) {
      notifyError(toErrorMessage(disconnectError, "Failed to disconnect Roo Code."))
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
