/**
 * Roo Code provider UI model refs (CLI `-m` refs, e.g.
 * `anthropic/claude-sonnet-4.5`).
 *
 * mausCode-authored (no upstream port). The native-print transport
 * passes UI refs to `roo -m` verbatim, so no ref mapping lives here
 * — only the default. Model ids are provider-scoped upstream: the
 * roo router drops unverified custom refs on the strict providers
 * (anthropic/openai-native/gemini) with a visible warning instead of
 * running a silently substituted model.
 */
export const DEFAULT_ROO_UI_MODEL = "anthropic/claude-opus-4.6"
