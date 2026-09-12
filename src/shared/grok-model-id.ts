/**
 * Grok provider UI model ids (CLI slugs, e.g. `grok-4-5`).
 *
 * mausCode-authored (no upstream port). The native-print transport passes
 * UI slugs to `grok -m` verbatim (the same ids `grok models` lists), so no
 * id mapping lives here — only the default. The invalid-model retry in the
 * grok router drops `-m` entirely (CLI default) when a slug drifts, so a
 * stale default degrades to one warning instead of a broken backend.
 */
export const DEFAULT_GROK_UI_MODEL = "grok-4-5"
