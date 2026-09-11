/**
 * Cursor provider UI model ids (short ids, e.g. `composer-2.5-fast`).
 *
 * NOTE (transplant lineage): this module previously held ACP
 * `languageModel()` bracket-id mappings from SamSammane/1code-ui
 * (Apache-2.0). The native-print transport passes UI short ids to
 * `agent --model` verbatim (the same ids `agent --list-models` uses),
 * so the ACP mapping was deleted 2026-09-11; only the default remains.
 * The invalid-model retry in the cursor router drops `--model`
 * entirely (CLI default) when a slug drifts, so a stale default
 * degrades to one warning instead of a broken backend.
 */
export const DEFAULT_CURSOR_UI_MODEL = "composer-2.5-fast"
