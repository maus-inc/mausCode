export const CLAUDE_MODELS = [
  { id: "opus", name: "Opus", version: "4.8" },
  { id: "opus[1m]", name: "Opus", version: "4.8 1M" },
  { id: "sonnet", name: "Sonnet", version: "4.6" },
  { id: "haiku", name: "Haiku", version: "4.5" },
]

export type CodexThinkingLevel = "low" | "medium" | "high" | "xhigh"

/** Codex models that require ChatGPT sign-in (not available with API key auth).
 * Transplanted from SamSammane/1code-ui (Apache-2.0). */
export const CODEX_SUBSCRIPTION_ONLY_MODEL_IDS = ["gpt-5.3-codex-spark"] as const

export const CODEX_MODELS = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.3-codex-spark",
    name: "Codex 5.3 Spark",
    thinkings: ["low", "medium", "high", "xhigh"] as CodexThinkingLevel[],
  },
] as const

export function formatCodexThinkingLabel(thinking: CodexThinkingLevel): string {
  if (thinking === "xhigh") return "Extra High"
  return thinking.charAt(0).toUpperCase() + thinking.slice(1)
}

/** Cursor CLI provider models (UI picker ids; see shared/cursor-model-id.ts).
 * Transplanted from SamSammane/1code-ui (Apache-2.0). */
export const CURSOR_MODELS = [
  { id: "composer-2.5", name: "Composer 2.5" },
  { id: "composer-2.5-fast", name: "Composer 2.5 Fast" },
  { id: "claude-4.6-sonnet-medium", name: "Sonnet 4.6" },
  { id: "claude-4.6-sonnet-medium-thinking", name: "Sonnet 4.6 Thinking" },
  { id: "claude-opus-4-8-high", name: "Opus 4.8" },
  { id: "gpt-5.5-medium", name: "GPT-5.5" },
  { id: "gpt-5.4-medium", name: "GPT-5.4" },
  { id: "gpt-5.3-codex", name: "Codex 5.3" },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
] as const

export const CURSOR_MODEL_IDS = new Set<string>(CURSOR_MODELS.map((model) => model.id))

/** Grok CLI provider models (UI picker ids; see shared/grok-model-id.ts).
 * mausCode-authored (no upstream port). Slugs pass to `grok -m` verbatim;
 * `grok listModels` is the dynamic source, this list is the offline picker. */
export const GROK_MODELS = [
  { id: "grok-4-5", name: "Grok 4.5" },
  { id: "grok-code-fast-1", name: "Grok Code Fast" },
  { id: "grok-4", name: "Grok 4" },
  { id: "grok-3", name: "Grok 3" },
] as const

export const GROK_MODEL_IDS = new Set<string>(GROK_MODELS.map((model) => model.id))

export const QWEN_MODELS = [
  { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
  { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
  { id: "qwen3-coder-turbo", name: "Qwen3 Coder Turbo" },
  { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
  { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
  { id: "qwen3.5-plus", name: "Qwen3.5 Plus" },
  { id: "qwen3-max-2026-01-23", name: "Qwen3 Max" },
  { id: "glm-5", name: "GLM-5" },
  { id: "glm-4.7", name: "GLM-4.7" },
  { id: "kimi-k2.5", name: "Kimi K2.5" },
  { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
] as const

export const QWEN_MODEL_IDS = new Set<string>(QWEN_MODELS.map((model) => model.id))

export const CLINE_MODELS = [
  { id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6" },
  { id: "anthropic/claude-fable-5.1", name: "Claude Fable 5.1" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  { id: "google/gemini-3-pro", name: "Gemini 3 Pro" },
  { id: "gpt-5", name: "GPT-5" },
] as const

export const CLINE_MODEL_IDS = new Set<string>(CLINE_MODELS.map((model) => model.id))

export const OPENCLAW_MODELS = [
  { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5" },
  { id: "openrouter/auto", name: "OpenRouter Auto" },
  { id: "xai/grok-4", name: "Grok 4" },
  { id: "xai/grok-code-fast-1", name: "Grok Code Fast" },
] as const

export const OPENCLAW_MODEL_IDS = new Set<string>(OPENCLAW_MODELS.map((model) => model.id))

/**
 * Roo Code UI model refs. roo listModels is provider-contextual
 * (only the effective provider's verified table); this union is the
 * offline fallback, so names carry their provider. All ids are
 * confirmed in the frozen upstream tables (see roo-print/auth-config).
 */
export const ROO_MODELS = [
  { id: "anthropic/claude-opus-4.6", name: "OpenRouter · Claude Opus 4.6" },
  { id: "anthropic/claude-sonnet-4.5", name: "OpenRouter · Claude Sonnet 4.5" },
  { id: "anthropic/claude-sonnet-4.6", name: "OpenRouter · Claude Sonnet 4.6" },
  { id: "anthropic/claude-opus-4.5", name: "OpenRouter · Claude Opus 4.5" },
  { id: "anthropic/claude-haiku-4.5", name: "OpenRouter · Claude Haiku 4.5" },
  { id: "google/gemini-2.5-pro", name: "OpenRouter · Gemini 2.5 Pro" },
  { id: "google/gemini-2.5-flash", name: "OpenRouter · Gemini 2.5 Flash" },
  { id: "claude-sonnet-4-5", name: "Anthropic · Claude Sonnet 4.5" },
  { id: "claude-sonnet-4-6", name: "Anthropic · Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", name: "Anthropic · Claude Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", name: "Anthropic · Claude Haiku 4.5" },
  { id: "gpt-5.1-codex-max", name: "OpenAI · GPT-5.1 Codex Max" },
  { id: "gpt-5.4", name: "OpenAI · GPT-5.4" },
  { id: "gpt-5", name: "OpenAI · GPT-5" },
  { id: "gpt-4o", name: "OpenAI · GPT-4o" },
  { id: "gemini-3.1-pro-preview", name: "Gemini · Gemini 3.1 Pro Preview" },
  { id: "gemini-3-pro-preview", name: "Gemini · Gemini 3 Pro Preview" },
  { id: "gemini-3-flash-preview", name: "Gemini · Gemini 3 Flash Preview" },
  { id: "gemini-2.5-pro", name: "Gemini · Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", name: "Gemini · Gemini 2.5 Flash" },
  { id: "anthropic/claude-sonnet-4", name: "Vercel · Claude Sonnet 4" },
] as const

export const ROO_MODEL_IDS = new Set<string>(ROO_MODELS.map((model) => model.id))

export const OPENROUTER_PROVIDER = "openrouter" as const

const CODEX_REASONING_EFFORT_SUFFIXES = new Set<string>(["low", "medium", "high", "xhigh"])

// Codex selections are persisted as `modelId` or `modelId/reasoningEffort`
// (e.g. `gpt-5.5/high`). The slash collides with OpenRouter's `provider/model`
// shape, so callers must run this check BEFORE `isOpenRouterModelId`.
export function isCodexModelSelection(modelId: string): boolean {
  const [baseId, reasoningEffort, ...rest] = modelId.split("/")
  if (!baseId || rest.length > 0) return false
  const normalized = baseId.toLowerCase()
  if (!normalized.startsWith("gpt-") && !normalized.includes("codex")) {
    return false
  }
  return reasoningEffort === undefined || CODEX_REASONING_EFFORT_SUFFIXES.has(reasoningEffort)
}

export function isOpenRouterModelId(modelId: string): boolean {
  // OpenRouter model IDs follow `provider/model-name`, e.g. `anthropic/claude-3.5-sonnet`,
  // `openai/gpt-4o`, `meta-llama/llama-3.3-70b-instruct`. The slash is the
  // canonical marker that distinguishes them from the flat IDs used by Claude,
  // Codex, and Gemini in this app.
  return modelId.includes("/")
}

export const GEMINI_MODELS = [
  { id: "auto-gemini-3", name: "Gemini 3", version: "Auto" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", version: "Preview" },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", version: "Preview" },
  { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite", version: "Preview" },
  { id: "auto-gemini-2.5", name: "Gemini 2.5", version: "Auto" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", version: "Pro" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", version: "Flash" },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", version: "Lite" },
] as const
