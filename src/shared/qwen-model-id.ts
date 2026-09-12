/**
 * Qwen provider UI model ids (CLI ids, e.g. `qwen3-coder-plus`).
 *
 * mausCode-authored (no upstream port). The native-print transport passes
 * UI ids to `qwen -m` verbatim (the same ids settings.json
 * `modelProviders` carry), so no id mapping lives here — only the
 * default. The invalid-model retry in the qwen router drops `-m`
 * entirely (CLI default) when an id drifts, so a stale default degrades
 * to one warning instead of a broken backend.
 */
export const DEFAULT_QWEN_UI_MODEL = "qwen3-coder-plus"
