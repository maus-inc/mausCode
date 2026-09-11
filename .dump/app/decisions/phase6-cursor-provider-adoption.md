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

## Outcome: ADOPTED 2026-09-11 (user-approved after Batch C), then RE-PLATFORMED to native print

Ported in brief order (model-id + CURSOR_MODELS + atoms -> binary + router ->
transport -> login UI -> selector/form/input wiring -> MCP tab), adapted to our
5-provider selector (gemini/openrouter kept) and per-subchat seed pattern.
Login surfaces via CursorLoginModal on auth-error; no models-tab section
(matches fork).

SUPERSEDED 2026-09-11: the ACP transport was replaced with native
`agent -p --output-format stream-json` print turns (`src/main/lib/cursor-print/`.
Reasons: print mode is the documented headless surface
(cursor.com/docs/cli/headless), needs no `@mcpc-tech/acp-ai-provider`
dependency, and every turn spawns a fresh process that re-reads mcp.json (no
stale-config fingerprinting). ACP packages were removed from package.json.

Final native-print shape (verified against official CLI docs + the documented
stream-json example script):
- argv: `-p --output-format stream-json --stream-partial-output`, `--model`,
  plan/ask via `--mode=plan|ask` (edit/agent/turbo use default agent mode),
  edit/agent add `--force`, turbo adds `--yolo`, always `--trust`;
  `--resume <chatId>` continues sessions. Retry loop downgrades stale-resume
  (fresh run), invalid-model (default), and unknown-flag (stable subset) errors.
- Binary resolution: `$CURSOR_AGENT_BIN` override, else `cursor-agent` then
  `agent` on PATH (Windows: `%LocalAppData%/cursor-agent` versioned dirs);
  `cursor-agent`-first dodges generic-`agent` name collisions.
- Auth: `CURSOR_API_KEY` env (documented headless auth) or interactive
  `agent login` browser flow; `agent status` is the auth probe for both the
  provider probe and the integration modal.
- Parser: assistant delta/snapshot dual-mode with repeat-flush dedupe,
  `*ToolCall` start/complete correlation (missing call_id -> oldest-open FIFO),
  `rejected` results surfaced as errors, stdin long-prompt carriage (argv kept
  as well under ~30K chars since stdin support is community-reported, not
  documented).
- Images: staged to disk and referenced by path in the prompt (the documented
  headless image mechanism: "the agent will read files through tool calls").
- MCP: project `.cursor/mcp.json` + global `~/.cursor/mcp.json` (Global group
  in the MCP tab, mirroring claude), official `${env:}`/`${userHome}`/
  `${workspaceFolder}` interpolation.

Risk #3 (model IDs) is retired as a blocker: invalid slugs are retried
against the default model automatically, so ID drift degrades to one
warning instead of a broken backend.

## Original recommendation (superseded): HOLD for explicit user decision

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

## Follow-ups (native-print era)

- Re-validate Composer model slugs against `agent models` output when a
  networked Cursor environment is available (sandbox blocks cursor.com TLS,
  so only the retry fallback is verified, not the slug list itself).
- Confirm `-p` stdin-prompt support (currently belt-and-suspenders) the same way.
- The 1code-ui fork lineage (SamSammane/1code-ui, Apache-2.0) is retained in
  `login`, `cursor-mcp`, and transport-file headers for attribution.
