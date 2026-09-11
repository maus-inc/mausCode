# Phase 6: Cursor CLI provider adoption — decision brief

Date: 2026-09-11. Source: SamSammane/1code-ui (Apache-2.0), commits 51b79a5 + 12f0676.
Provenance: reviewed full diffs of both commits (dist-web build output excluded).

## What the fork offers

A complete 5th provider ("Cursor CLI") driving the `cursor-agent` binary over ACP:
- Backend: `cursor.ts` router (~941 lines: login flow, chat streaming, cancel,
  cleanup, MCP config), `cursor-agent-binary.ts` (161), `cursor-mcp.ts` (350),
  `shared/cursor-model-id.ts` (model resolution), CURSOR_MODELS + Composer
  models, MCP-tab Cursor section, login modal + content.
- Renderer: `cursor-chat-transport.ts` (279), provider-union widening,
  model-selector/new-chat-form/chat-input wiring, `subChatCursorModelIdAtomFamily`.
- Requires: `cursor-agent` on PATH (Windows: %LocalAppData%/cursor-agent) +
  Cursor subscription; `@mcpc-tech/acp-ai-provider` (already in our tree).

## Recommendation: HOLD for explicit user decision (user-facing scope)

1. mausCode already serves 4 providers + native; a 5th provider adds login UX,
   onboarding, settings, testing, and support surface.
2. Our UI already carries a disabled "Cursor CLI" placeholder (new-chat-form,
   active-chat agents list) — demand signal exists but adoption is a product call.
3. Technical risk is moderate (ACP pattern mirrors our Codex adapter), but the
   fork's Cursor code is a June snapshot; model IDs would need re-validation.

## Already taken from Phase 6 (no adoption required)

- `cli-binaries.ts` + codex/claude PATH fallback; CODEX_SUBSCRIPTION_ONLY_MODEL_IDS
  + filters; hidden-models v5. Rejected: vendor-auth-optional (opposite of maus
  sign-in direction), web-standalone track (out of scope), 1M context bump
  (unverifiable), model-list refreshes (erenbertr lineage newer).

## If adopted later

Port order: cursor-model-id + CURSOR_MODELS + atoms -> binary + router ->
transport -> login UI -> selector/form/input wiring -> MCP tab. Re-validate
Composer model IDs against `cursor-agent` ACP session availability first.
