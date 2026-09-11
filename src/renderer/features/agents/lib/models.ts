export const CLAUDE_MODELS = [
  { id: "opus", name: "Opus", version: "4.8" },
  { id: "opus[1m]", name: "Opus", version: "4.8 1M" },
  { id: "sonnet", name: "Sonnet", version: "4.6" },
  { id: "haiku", name: "Haiku", version: "4.5" },
]

export type CodexThinkingLevel = "low" | "medium" | "high" | "xhigh"

/** Codex models that require ChatGPT sign-in (not available with API key auth).
 * Transplanted from SamSammane/1code-ui (Apache-2.0). */
export const CODEX_SUBSCRIPTION_ONLY_MODEL_IDS = [
  "gpt-5.3-codex-spark",
] as const

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
]

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
]

export const CURSOR_MODEL_IDS = new Set(CURSOR_MODELS.map((model) => model.id))

export const OPENROUTER_PROVIDER = "openrouter" as const

const CODEX_REASONING_EFFORT_SUFFIXES = new Set<string>([
  "low",
  "medium",
  "high",
  "xhigh",
])

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
  return (
    reasoningEffort === undefined ||
    CODEX_REASONING_EFFORT_SUFFIXES.has(reasoningEffort)
  )
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
]

