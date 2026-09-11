/**
 * OpenClaw provider UI model refs (CLI refs, e.g. `openai/gpt-5.6-sol`).
 *
 * mausCode-authored (no upstream port). The native-print transport
 * passes UI refs to `agent exec --model` verbatim, so no ref mapping
 * lives here — only the default. The invalid-model retry in the
 * openclaw router drops `--model` entirely (config default) when a
 * ref drifts, so a stale default degrades to one warning instead of
 * a broken backend.
 */
export const DEFAULT_OPENCLAW_UI_MODEL = "openai/gpt-5.6-sol"
