/**
 * mausCode useQwenLoginFlow: API-credential connect + verify.
 * Mirrors useCursorLoginFlow (ours, NOT verbatim).
 *
 * Upstream removed `qwen auth`, so there is no browser/device flow to
 * poll: connecting means storing one API credential (preset endpoint +
 * key + model) via trpc.qwen.saveCredentials, then verifying through
 * trpc.qwen.getIntegration. The state machine keeps the modal-shell
 * shape (idle/running/success/error) so the retry/close wiring stays
 * identical to the sibling login modals.
 */
import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { trpc, trpcClient } from "../../../lib/trpc"

export type QwenLoginFlowState = "idle" | "running" | "success" | "error" | "cancelled"

export type QwenAuthPreset = {
  id: string
  label: string
  authType: "openai" | "openai-responses" | "anthropic" | "qwen-oauth" | "gemini" | "vertex-ai"
  baseUrl: string
  model: string
  keyPlaceholder: string
}

/** Docs-verified endpoints (qwen-code auth guide, 2026-09). */
export const QWEN_AUTH_PRESETS: QwenAuthPreset[] = [
  {
    id: "coding-intl",
    label: "Alibaba Coding Plan (intl)",
    authType: "openai",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
    model: "qwen3-coder-plus",
    keyPlaceholder: "sk-sp-...",
  },
  {
    id: "coding-cn",
    label: "Alibaba Coding Plan (China)",
    authType: "openai",
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    model: "qwen3-coder-plus",
    keyPlaceholder: "sk-sp-...",
  },
  {
    id: "token-sg",
    label: "Alibaba Token Plan (Singapore)",
    authType: "openai",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-plus",
    keyPlaceholder: "Token Plan API key",
  },
  {
    id: "token-cn",
    label: "Alibaba Token Plan (Beijing)",
    authType: "openai",
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-plus",
    keyPlaceholder: "Token Plan API key",
  },
  {
    id: "dashscope",
    label: "Alibaba DashScope (pay-as-you-go)",
    authType: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3-coder-plus",
    keyPlaceholder: "sk-...",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    authType: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "qwen/qwen3-coder-plus",
    keyPlaceholder: "sk-or-...",
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible endpoint",
    authType: "openai",
    baseUrl: "",
    model: "qwen3-coder-plus",
    keyPlaceholder: "API key",
  },
]

const VERIFY_ATTEMPTS = 6
const VERIFY_DELAY_MS = 400

function isTerminalState(state: QwenLoginFlowState): boolean {
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

export function useQwenLoginFlow() {
  const [presetId, setPresetId] = useState<string>(QWEN_AUTH_PRESETS[0].id)
  const [apiKey, setApiKey] = useState<string>("")
  const [baseUrl, setBaseUrl] = useState<string>(QWEN_AUTH_PRESETS[0].baseUrl)
  const [model, setModel] = useState<string>(QWEN_AUTH_PRESETS[0].model)
  const [state, setState] = useState<QwenLoginFlowState>("idle")
  const [detail, setDetail] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  // True when the modal opened over an already-connected backend: the
  // modal shows the connected panel (detail + Disconnect) instead of
  // auto-closing, since held credentials are mausCode-owned lifecycle.
  const [alreadyConnected, setAlreadyConnected] = useState<boolean>(false)

  const cancelledRef = useRef(false)
  const successToastRef = useRef(false)
  const lastErrorToastRef = useRef<string | null>(null)

  const saveMutation = trpc.qwen.saveCredentials.useMutation()
  const testMutation = trpc.qwen.testConnection.useMutation()
  const disconnectMutation = trpc.qwen.disconnect.useMutation()
  const trpcUtils = trpc.useUtils()

  const preset =
    QWEN_AUTH_PRESETS.find((candidate) => candidate.id === presetId) ?? QWEN_AUTH_PRESETS[0]

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
        const integration = await trpcClient.qwen.getIntegration.query()
        if (integration.isConnected) {
          await trpcUtils.qwen.getIntegration.invalidate()
          setState("success")
          setError(null)
          if (!successToastRef.current) {
            successToastRef.current = true
            toast.success("Qwen connected successfully", { duration: 10000 })
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
      ? toErrorMessage(lastVerifyError, "Failed to verify Qwen connection status. Please retry.")
      : "Qwen credentials saved, but the connection was not detected. Please retry."

    setState("error")
    setError(message)
    notifyError(message)
    return false
  }, [notifyError, trpcUtils])

  const selectPreset = useCallback((nextPresetId: string) => {
    const next =
      QWEN_AUTH_PRESETS.find((candidate) => candidate.id === nextPresetId) ?? QWEN_AUTH_PRESETS[0]
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
      const integration = await trpcClient.qwen.getIntegration.query()
      if (integration.isConnected) {
        await trpcUtils.qwen.getIntegration.invalidate()
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
        authType: preset.authType,
        apiKey: trimmedKey,
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
        "Failed to save Qwen credentials. Please try again.",
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
    preset.authType,
    preset.label,
    saveMutation,
    verifyConnected,
  ])

  const test = useCallback(async () => {
    if (testMutation.isPending) return
    try {
      const result = await testMutation.mutateAsync()
      setDetail(result.detail)
      if (result.ok) {
        toast.success("Qwen connection looks good", {
          description: result.detail,
        })
      } else {
        notifyError(result.detail || "Qwen connection check failed.")
      }
    } catch (testError) {
      notifyError(toErrorMessage(testError, "Qwen connection check failed."))
    }
  }, [notifyError, testMutation])

  const disconnect = useCallback(async () => {
    try {
      await disconnectMutation.mutateAsync()
      await trpcUtils.qwen.getIntegration.invalidate()
      setAlreadyConnected(false)
      setState("idle")
      setError(null)
      setDetail("Disconnected. Ambient qwen CLI config is untouched.")
      toast.success("Qwen disconnected")
    } catch (disconnectError) {
      notifyError(toErrorMessage(disconnectError, "Failed to disconnect Qwen."))
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
