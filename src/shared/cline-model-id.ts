/**
 * Cline provider UI model ids (CLI ids, e.g. `anthropic/claude-opus-4-6`).
 *
 * mausCode-authored (no upstream port). The native-print transport
 * passes UI ids to `cline -m` verbatim, so no id mapping lives here —
 * only the default. The invalid-model retry in the cline router drops
 * `-m` entirely (provider default) when an id drifts, so a stale
 * default degrades to one warning instead of a broken backend.
 */
export const DEFAULT_CLINE_UI_MODEL = "anthropic/claude-opus-4-6"
