/**
 * Codex provider models, default model id and reasoning effort.
 *
 * mausCode-authored, with the model list transplanted from
 * SamSammane/1code-ui (Apache-2.0) as it was in the renderer picker. It lives
 * here because the main process validates the CLI's catalog against it, and
 * `AGENTS.md` puts what two processes must agree on in `src/shared`.
 *
 * The model id and the effort are two values, never one slash-joined string.
 * The joined form is what let the main router and the renderer transport
 * drift to `"gpt-5.5"` and `"gpt-5.5/high"` at the same time, verified
 * 2026-09-15, so a chat with no model chosen behaved differently depending on
 * which path sent the turn.
 *
 * The default below is the static fallback, not the answer. The pinned Codex
 * CLI is the catalog: `src/main/lib/providers/codex-models.ts` reads it at
 * runtime through the app-server `model/list` request, validates the answer
 * against `CODEX_MODELS`, and only falls back to these values when the CLI
 * cannot answer. A hardcoded id goes stale on the next CLI release, which is
 * the bug this module exists to keep from coming back. Ratified 2026-09-13 in
 * `.dump/global/decisions.md`; the two literals the release note carried,
 * `gpt-5.5` and `gpt-5.4`, were both refused.
 */
import type { EffortLevel } from "./effort"

/**
 * The four levels Codex sends. `satisfies` keeps the tuple type the picker
 * already depends on while proving every member is in the one effort vocabulary
 * in `src/shared/effort.ts`.
 */
export const CODEX_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const satisfies readonly EffortLevel[]

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number]

/**
 * The picker's own name for an effort. It is a pure alias of
 * `CodexReasoningEffort`, so SonarCloud rule typescript:S6564 flags it as
 * redundant and it is the one open finding on PR #55.
 *
 * Left in place deliberately. 25 of its 31 occurrences sit in
 * `src/renderer/features/agents`, in `agent-model-selector.tsx`,
 * `acp-chat-transport.ts`, `chat-input-area.tsx` and `new-chat-form.tsx`,
 * which name the concept `thinkings`, `selectedThinking` and
 * `onSelectThinking` throughout. Roadmap step 05 moved this module to
 * `src/shared` on the promise that the picker's imports would not move, and
 * deleting the alias breaks that promise for no behaviour change.
 *
 * Whoever retires it should rename all 25 at once, drop this alias and the
 * `CodexThinkingLevel` line from the re-export in
 * `src/renderer/features/agents/lib/models.ts`, and confirm
 * `npm run typecheck` still reports 0 errors. The effort label is
 * `formatEffortLabel` in `src/shared/effort.ts`; the picker calls that directly
 * now that both backends share one effort vocabulary, and the Codex-named
 * wrapper it used to call is gone rather than left as a second name for it.
 */
export type CodexThinkingLevel = CodexReasoningEffort

/** Codex models that require ChatGPT sign-in, not available with API key auth. */
export const CODEX_SUBSCRIPTION_ONLY_MODEL_IDS = ["gpt-5.3-codex-spark"] as const

/** The offline picker list, and the list a CLI catalog answer is checked against. */
export const CODEX_MODELS = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    thinkings: [...CODEX_REASONING_EFFORTS] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    thinkings: [...CODEX_REASONING_EFFORTS] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    thinkings: [...CODEX_REASONING_EFFORTS] as CodexThinkingLevel[],
  },
  {
    id: "gpt-5.3-codex-spark",
    name: "Codex 5.3 Spark",
    thinkings: [...CODEX_REASONING_EFFORTS] as CodexThinkingLevel[],
  },
] as const

export const DEFAULT_CODEX_UI_MODEL = "gpt-5.5"

/** Effort sent when a chat has no stored effort and the CLI answers nothing. */
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "high"

const REASONING_EFFORT_VALUES: ReadonlySet<string> = new Set(CODEX_REASONING_EFFORTS)

export function isCodexReasoningEffort(value: string): value is CodexReasoningEffort {
  return REASONING_EFFORT_VALUES.has(value)
}
