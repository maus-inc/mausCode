/**
 * NOTE (transplant): Cursor Agent ACP model-id resolution.
 * Source: SamSammane/1code-ui (Apache-2.0), commits 51b79a5 + 12f0676.
 * UI picker ids <-> bracketed ACP languageModel() ids with session fallback.
 */
/**
 * Cursor Agent ACP uses bracketed model ids (e.g. composer-2.5[fast=true]).
 * The UI / `agent --list-models` use short ids (e.g. composer-2.5-fast).
 */
export const DEFAULT_CURSOR_UI_MODEL = "composer-2.5-fast"

/** UI picker id → best-guess ACP `languageModel()` id (used when session models are unknown) */
export const CURSOR_UI_TO_ACP_MODEL: Record<string, string> = {
  "composer-2.5": "composer-2.5[fast=false]",
  "composer-2.5-fast": "composer-2.5[fast=true]",
  "gemini-3.1-pro": "gemini-3.1-pro[]",
  "gpt-5.5-medium": "gpt-5.5[context=272k,reasoning=medium,fast=false]",
  "gpt-5.4-medium": "gpt-5.4[context=272k,reasoning=medium,fast=false]",
  "gpt-5.3-codex": "gpt-5.3-codex[reasoning=medium,fast=false]",
  "claude-4.6-sonnet-medium":
    "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]",
  "claude-4.6-sonnet-medium-thinking":
    "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]",
  "claude-opus-4-8-high":
    "claude-opus-4-8[thinking=true,context=300k,effort=high,fast=false]",
  // Legacy UI ids
  "gpt-5": "gpt-5.5[context=272k,reasoning=medium,fast=false]",
  "sonnet-4": "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]",
  "sonnet-4-thinking":
    "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]",
}

export type CursorSessionModels = {
  availableModels?: Array<{ modelId: string; name?: string }>
  currentModelId?: string
}

export function resolveCursorAcpModelId(uiModelId: string): string {
  const trimmed = uiModelId.trim()
  if (!trimmed) {
    return (
      CURSOR_UI_TO_ACP_MODEL[DEFAULT_CURSOR_UI_MODEL] ??
      DEFAULT_CURSOR_UI_MODEL
    )
  }
  if (trimmed.includes("[")) return trimmed
  return CURSOR_UI_TO_ACP_MODEL[trimmed] ?? trimmed
}

/** Ordered candidates to try against ACP `availableModels`. */
export function cursorModelCandidates(uiModelId: string): string[] {
  const ui = uiModelId.trim() || DEFAULT_CURSOR_UI_MODEL
  const ordered: string[] = []
  const add = (id: string) => {
    if (id && !ordered.includes(id)) ordered.push(id)
  }

  add(resolveCursorAcpModelId(ui))
  add(ui)

  if (ui.includes("composer")) {
    const wantFast = ui.includes("fast")
    if (wantFast) {
      add("composer-2.5[fast=true]")
      add("composer-2.5-fast")
    } else {
      add("composer-2.5[fast=false]")
      add("composer-2.5[fast=true]")
      add("composer-2.5")
    }
    return ordered
  }

  const mapped = CURSOR_UI_TO_ACP_MODEL[ui]
  if (mapped) {
    const base = mapped.split("[")[0]!
    add(mapped)
    // Variants with different bracket params share the same base id prefix.
    return ordered
  }

  return ordered
}

function findComposerModel(
  available: string[],
  wantFast: boolean,
): string | undefined {
  if (wantFast) {
    return (
      available.find((id) => /composer-2\.5.*\[fast=true\]/.test(id)) ??
      available.find((id) => id.includes("composer-2.5") && id.includes("fast=true"))
    )
  }
  return (
    available.find((id) => /composer-2\.5.*\[fast=false\]/.test(id)) ??
    available.find(
      (id) => id.includes("composer-2.5") && id.includes("fast=false"),
    ) ??
    available.find((id) => id.includes("composer-2.5"))
  )
}

function findByMappedPrefix(ui: string, available: string[]): string | undefined {
  const mapped = CURSOR_UI_TO_ACP_MODEL[ui]
  if (!mapped) return undefined

  const exact = available.find((id) => id === mapped)
  if (exact) return exact

  const base = mapped.split("[")[0]!
  const sameBase = available.filter((id) => id.startsWith(`${base}[`))
  if (sameBase.length === 1) return sameBase[0]

  if (ui.includes("thinking")) {
    const thinking = sameBase.find((id) => id.includes("thinking=true"))
    if (thinking) return thinking
  }

  return sameBase[0]
}

/**
 * Pick an ACP model id that exists in the session's `availableModels` list.
 * Falls back to static mapping when the session has not reported models yet.
 */
export function pickCursorModelForSession(
  uiModelId: string,
  models?: CursorSessionModels,
): string {
  const ui = uiModelId.trim() || DEFAULT_CURSOR_UI_MODEL
  const available = models?.availableModels?.map((m) => m.modelId) ?? []

  if (available.length === 0) {
    return resolveCursorAcpModelId(ui)
  }

  for (const candidate of cursorModelCandidates(ui)) {
    if (available.includes(candidate)) return candidate
  }

  if (ui.includes("composer")) {
    const wantFast = ui.includes("fast") || ui === DEFAULT_CURSOR_UI_MODEL
    const composer = findComposerModel(available, wantFast)
    if (composer) return composer
  }

  const prefixMatch = findByMappedPrefix(ui, available)
  if (prefixMatch) return prefixMatch

  const loose = available.find(
    (id) => id.startsWith(ui) || id.includes(ui.replace(/-medium|-thinking|-fast/g, "")),
  )
  if (loose) return loose

  return models?.currentModelId ?? available[0]!
}
