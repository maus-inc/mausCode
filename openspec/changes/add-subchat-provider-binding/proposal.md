# Change: Persist sub-chat provider binding in the database

## Why

Every sub-chat's provider (claude-code/codex/gemini/openrouter/cursor) is
re-inferred from message metadata on every render
(`inferProviderFromMessages` in active-chat.tsx), with `useState` overrides
for empty chats and `transport instanceof` back-inference. At 5 providers the
ordering is fragile: cursor's `gpt-5.*` model ids must be checked before the
codex check, openrouter's `provider/model` slash collides with codex's
`model/effort` slash, and empty chats have no metadata at all. A wrong guess
routes a chat to the wrong transport/backend. (Same diagnosis as Locus
`2026-08-27-add-chat-session-binding`; our slice is minimal: provider only,
no runtime/profile/gateway concepts.)

## What Changes

- Add nullable `provider TEXT` column to `sub_chats` (drizzle migration
  0010). NULL = legacy row, keep inferring.
- chats router: `create`/`createSubChat` accept optional `provider`;
  `forkSubChat` copies the source binding; new `updateSubChatProvider`
  mutation validates against the 5-provider union.
- Renderer: binding-first read-through — stored binding wins, then
  override/infer fallbacks; write-through on create, provider switch,
  continue-with-provider, fork; lazy backfill (persist inferred provider
  when the stored binding is NULL).
- Model/thinking/engine truth stays in localStorage atomFamilies (already
  keyed by sub-chat id, no inference involved) — out of scope.

## Impact

- Affected specs: none (no spec dir yet for chats; router + schema + renderer).
- Affected code: db schema + drizzle migration, chats router, shared
  provider union, active-chat infer + create/fork/switch paths, new-chat-form
  create call.
- Backwards compatible: NULL bindings behave exactly as today.
