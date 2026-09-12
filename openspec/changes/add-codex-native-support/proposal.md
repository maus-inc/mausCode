# Change: add-codex-native-support

## Why

P1 limits the native engine to local claude-code chats: Codex conversations
stay on the ACP transport by construction (selection order puts codex first,
and the engine toggle is disabled for codex). Two futures exist — teach the
native path to serve Codex-backed sessions, or declare Codex permanently
adapter-served — and the choice shapes the daemon host (provider plumbing),
the credential story (Codex auth is not an exportable key), and the engine
toggle's availability rules. This change forces the decision first and
implements only what the decision requires.

## What changes

- Task 1 is the decision, made by the human with a technical recommendation:
  support Codex on native vs document wontfix with rationale.
- If SUPPORT: provider plumbing for Codex-backed sessions on the daemon
  (auth mechanism that is not an exportable key), credential resolution for
  it, engine-toggle availability for codex chats, and selection-order update.
  The spec below describes this end state.
- If WONTFIX: the decision and rationale are recorded in `decisions/` and
  second-brain, the toggle's disabled state for codex gains accurate copy,
  and this change closes with implementation tasks struck (not silently
  dropped). No code beyond the copy change.
- Either way, no behavior changes until the decision is recorded.

## Non-goals

- No changes to the ACP transport or the legacy codex path in either outcome.
- No new provider catalog entries (Codex auth rides existing mechanisms).
- If SUPPORT: no offline-Codex, no custom-endpoint-Codex beyond what
  `add-native-endpoint-config` provides generally.

## Impact

- SUPPORT: medium — daemon provider plumbing + credential path + toggle rules.
- WONTFIX: one accurate disabled-state string + decision records.
- Approval requested for the decision step; implementation (if any) is covered
  by the same approval once the decision is recorded.
