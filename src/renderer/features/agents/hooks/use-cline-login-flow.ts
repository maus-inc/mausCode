/**
 * mausCode useClineLoginFlow: BYOK credential connect + verify.
 * Mirrors useQwenLoginFlow (ours, NOT verbatim).
 *
 * Cline's interactive `cline auth` writes plaintext keys to
 * providers.json, so mausCode holds ONE encrypted credential instead
 * and injects it per-run via `-P/-k/-m`. Custom-endpoint credentials
 * additionally run inside a per-turn isolated CLINE_DATA_DIR (the CLI
 * has no per-run baseUrl flag). Local runtimes (Ollama/LM Studio)
 * take no key.
 */
import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { trpc, trpcClient } from "../../../lib/trpc"

export type ClineLoginFlowState = "idle" | "running" | "success" | "error" | "cancelled"

export type ClineAuthPreset = {
  id: string
  label: string
  provider: "openrouter" | "anthropic" | "openai-native" | "deepseek" | "ollama" | "lmstudio"
  baseUrl: string
  /** Locked endpoint (only custom presets allow editing). */
  lockBaseUrl: boolean
  /** Empty = CLI provider default. */
  model: string
  keyPlaceholder: string
  /** Local runtimes take no key. */
  keyRequired: boolean
}

/** Provider ids verified in the CLI binary + `cline auth` runs. */
export const CLINE_AUTH_PRESETS: ClineAuthPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    provider: "openrouter",
    baseUrl: "",
    lockBaseUrl: true,
    model: "google/gemini-3-pro",
    keyPlaceholder: "sk-or-...",
    keyRequired: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    baseUrl: "",
    lockBaseUrl: true,
    model: "anthropic/claude-opus-4-6",
    keyPlaceholder: "sk-ant-...",
    keyRequired: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai-native",
    // Empty = the CLI's built-in OpenAI endpoint. A stored baseUrl
    // would force every turn through the isolated-data-dir path.
    baseUrl: "",
    lockBaseUrl: true,
    model: "gpt-5",
    keyPlaceholder: "sk-...",
    keyRequired: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    provider: "deepseek",
    baseUrl: "",
    lockBaseUrl: true,
    model: "",
    keyPlaceholder: "sk-...",
    keyRequired: true,
  },
  {
    id: "ollama",
    label: "Ollama (local, no key)",
    provider: "ollama",
    baseUrl: "",
    lockBaseUrl: true,
    model: "",
    keyPlaceholder: "",
    keyRequired: false,
  },
  {
    id: "lmstudio",
    label: "LM Studio (local, no key)",
    provider: "lmstudio",
    baseUrl: "",
    lockBaseUrl: true,
    model: "",
    keyPlaceholder: "",
    keyRequired: false,
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible endpoint",
    provider: "openai-native",
    baseUrl: "",
    lockBaseUrl: false,
    model: "gpt-5",
    keyPlaceholder: "API key",
    keyRequired: true,
  },
]

const VERIFY_ATTEMPTS = 6
const VERIFY_DELAY_MS = 400

function isTerminalState(state: ClineLoginFlowState): boolean {
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

export function useClineLoginFlow() {
  const [presetId, setPresetId] = useState<string>(CLINE_AUTH_PRESETS[0].id)
  const [apiKey, setApiKey] = useState<string>("")
  const [baseUrl, setBaseUrl] = useState<string>(CLINE_AUTH_PRESETS[0].baseUrl)
  const [model, setModel] = useState<string>(CLINE_AUTH_PRESETS[0].model)
  const [state, setState] = useState<ClineLoginFlowState>("idle")
  const [detail, setDetail] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  // True when the modal opened over an already-connected backend: the
  // modal shows the connected panel (detail + Disconnect) instead of
  // auto-closing, since held credentials are mausCode-owned lifecycle.
  const [alreadyConnected, setAlreadyConnected] = useState<boolean>(false)

  const cancelledRef = useRef(false)
  const successToastRef = useRef(false)
  const lastErrorToastRef = useRef<string | null>(null)

  const saveMutation = trpc.cline.saveCredentials.useMutation()
  const testMutation = trpc.cline.testConnection.useMutation()
  const disconnectMutation = trpc.cline.disconnect.useMutation()
  const trpcUtils = trpc.useUtils()

  const preset =
    CLINE_AUTH_PRESETS.find((candidate) => candidate.id === presetId) ?? CLINE_AUTH_PRESETS[0]

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
        const integration = await trpcClient.cline.getIntegration.query()
        if (integration.isConnected) {
          await trpcUtils.cline.getIntegration.invalidate()
          setState("success")
          setError(null)
          if (!successToastRef.current) {
            successToastRef.current = true
            toast.success("Cline connected successfully", { duration: 10000 })
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
      ? toErrorMessage(lastVerifyError, "Failed to verify Cline connection status. Please retry.")
      : "Cline credentials saved, but the connection was not detected. Please retry."

    setState("error")
    setError(message)
    notifyError(message)
    return false
  }, [notifyError, trpcUtils])

  const selectPreset = useCallback((nextPresetId: string) => {
    const next =
      CLINE_AUTH_PRESETS.find((candidate) => candidate.id === nextPresetId) ?? CLINE_AUTH_PRESETS[0]
    setPresetId(next.id)
    setBaseUrl(next.baseUrl)
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
      const integration = await trpcClient.cline.getIntegration.query()
      if (integration.isConnected) {
        await trpcUtils.cline.getIntegration.invalidate()
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
    if (preset.keyRequired && !trimmedKey) {
      const message = "Enter an API key to connect."
      setState("error")
      setError(message)
      notifyError(message)
      return
    }
    if (!preset.lockBaseUrl && !baseUrl.trim()) {
      const message = "Enter the endpoint base URL."
      setState("error")
      setError(message)
      notifyError(message)
      return
    }

    try {
      await saveMutation.mutateAsync({
        provider: preset.provider,
        ...(trimmedKey ? { apiKey: trimmedKey } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
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
        "Failed to save Cline credentials. Please try again.",
      )
      setState("error")
      setError(message)
      notifyError(message)
    }
  }, [
    apiKey,
    baseUrl,
    model,
    notifyError,
    preset.keyRequired,
    preset.label,
    preset.lockBaseUrl,
    preset.provider,
    saveMutation,
    verifyConnected,
  ])

  const test = useCallback(async () => {
    if (testMutation.isPending) return
    try {
      const result = await testMutation.mutateAsync()
      setDetail(result.detail)
      if (result.ok) {
        toast.success("Cline connection looks good", {
          description: result.detail,
        })
      } else {
        notifyError(result.detail || "Cline connection check failed.")
      }
    } catch (testError) {
      notifyError(toErrorMessage(testError, "Cline connection check failed."))
    }
  }, [notifyError, testMutation])

  const disconnect = useCallback(async () => {
    try {
      await disconnectMutation.mutateAsync()
      await trpcUtils.cline.getIntegration.invalidate()
      setAlreadyConnected(false)
      setState("idle")
      setError(null)
      setDetail("Disconnected. Ambient cline CLI config is untouched.")
      toast.success("Cline disconnected")
    } catch (disconnectError) {
      notifyError(toErrorMessage(disconnectError, "Failed to disconnect Cline."))
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
    baseUrl,
    setBaseUrl,
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
