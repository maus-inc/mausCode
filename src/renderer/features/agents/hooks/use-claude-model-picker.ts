/**
 * The Claude half of the model picker, which two surfaces render: the composer
 * of an open chat and the new-chat form. Each held its own copy of the model
 * list, the offline read, the connection test, the capability question and the
 * thinking and effort atoms, and then built thirteen identical props out of
 * them, so a change to one surface missed the other until somebody noticed. The
 * hook owns that state and returns the props the two share; each surface keeps
 * the two that are genuinely its own — which model is selected, and what
 * selecting one means there.
 */
import { useAtom, useAtomValue } from "jotai"
import { EFFORT_LEVELS } from "../../../../shared/effort"
import {
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  claudeEffortAtom,
  customClaudeConfigAtom,
  extendedThinkingEnabledAtom,
  normalizeCustomClaudeConfig,
  selectedOllamaModelAtom,
  showOfflineModeFeaturesAtom,
} from "../../../lib/atoms"
import { trpc } from "../../../lib/trpc"
import type { AgentModelSelectorProps } from "../components/agent-model-selector"
import { CLAUDE_MODELS } from "../lib/models"

/**
 * The picker props both surfaces pass identically. Typed from the component's
 * own contract, so a prop added to `AgentModelSelectorProps` that both surfaces
 * owe fails typecheck here until it is wired once, rather than being added to
 * one call site and forgotten in the other.
 */
export type SharedClaudePickerProps = Omit<
  AgentModelSelectorProps["claude"],
  "selectedModelId" | "onSelectModel"
>

// Available Claude models, plus the Ollama ones an offline turn can use.
function useAvailableModels() {
  const showOfflineFeatures = useAtomValue(showOfflineModeFeaturesAtom)
  const { data: ollamaStatus } = trpc.ollama.getStatus.useQuery(undefined, {
    refetchInterval: showOfflineFeatures ? 30000 : false,
    enabled: showOfflineFeatures, // Only query Ollama when offline mode is enabled
  })

  const baseModels = CLAUDE_MODELS

  const isOffline = ollamaStatus ? !ollamaStatus.internet.online : false
  const hasOllama = ollamaStatus?.ollama.available && (ollamaStatus.ollama.models?.length ?? 0) > 0
  const ollamaModels = ollamaStatus?.ollama.models || []
  const recommendedModel = ollamaStatus?.ollama.recommendedModel

  // Only show offline models if:
  // 1. Debug flag is enabled (showOfflineFeatures)
  // 2. Ollama is available with models
  // 3. User is actually offline
  if (showOfflineFeatures && hasOllama && isOffline) {
    return {
      models: baseModels,
      ollamaModels,
      recommendedModel,
      isOffline,
      hasOllama: true,
    }
  }

  return {
    models: baseModels,
    ollamaModels: [] as string[],
    recommendedModel: undefined as string | undefined,
    isOffline,
    hasOllama: false,
  }
}

export function useClaudeModelPicker(hiddenModels: readonly string[]) {
  const availableModels = useAvailableModels()

  // A custom config counts as connected: the turn goes to the endpoint it names
  // rather than to an account this app signed into.
  const customClaudeConfig = useAtomValue(customClaudeConfigAtom)
  const hasCustomClaudeConfig = Boolean(normalizeCustomClaudeConfig(customClaudeConfig))
  const anthropicOnboardingCompleted = useAtomValue(anthropicOnboardingCompletedAtom)
  const apiKeyOnboardingCompleted = useAtomValue(apiKeyOnboardingCompletedAtom)
  const { data: claudeCodeIntegration } = trpc.claudeCode.getIntegration.useQuery()
  const isClaudeConnected =
    Boolean(claudeCodeIntegration?.isConnected) ||
    anthropicOnboardingCompleted ||
    apiKeyOnboardingCompleted ||
    hasCustomClaudeConfig

  const [selectedOllamaModel, setSelectedOllamaModel] = useAtom(selectedOllamaModelAtom)
  // The model an offline turn actually runs: the picked one, else the one
  // Ollama recommends, else the first one available.
  const currentOllamaModel =
    selectedOllamaModel || availableModels.recommendedModel || availableModels.ollamaModels[0]

  const [thinkingEnabled, setThinkingEnabled] = useAtom(extendedThinkingEnabledAtom)

  // The effort rows come from the backend's own capability profile, so a
  // provider that reports no effort control shows no sub-menu.
  const { data: claudeCapability } = trpc.providers.get.useQuery({ id: "claude" })
  const claudeEfforts = claudeCapability?.features.effort ? EFFORT_LEVELS : []
  const [selectedClaudeEffort, setSelectedClaudeEffort] = useAtom(claudeEffortAtom)

  const props: SharedClaudePickerProps = {
    models: availableModels.models.filter((model) => !hiddenModels.includes(model.id)),
    hasCustomModelConfig: hasCustomClaudeConfig,
    isOffline: availableModels.isOffline && availableModels.hasOllama,
    ollamaModels: availableModels.ollamaModels,
    selectedOllamaModel: currentOllamaModel,
    recommendedOllamaModel: availableModels.recommendedModel,
    onSelectOllamaModel: setSelectedOllamaModel,
    isConnected: isClaudeConnected,
    thinkingEnabled,
    onThinkingChange: setThinkingEnabled,
    efforts: claudeEfforts,
    selectedEffort: selectedClaudeEffort,
    onSelectEffort: setSelectedClaudeEffort,
  }

  // The connection test travels inside `props`; neither surface reads it apart
  // from the picker, so it is not part of the return.
  return {
    availableModels,
    hasCustomClaudeConfig,
    currentOllamaModel,
    props,
  }
}
