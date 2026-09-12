# Adopt 5 agent modes (Plan/Ask/Edit/Agent/Turbo)

## Why
Two modes (plan/agent) give users no middle ground between read-only and
full-bypass. Five autonomy-ordered modes — Plan < Ask < Edit < Agent < Turbo —
let users match agent autonomy to the task. User-approved 2026-09-11:
role-based wording (Agent/Turbo, not Auto/Bypass) and model-agnostic (no
Opus gating). See `.dump/app/decisions/user-decisions-2026-09-11.md`.

## What changes
- `AgentMode` becomes `"plan" | "ask" | "edit" | "agent" | "turbo"`.
  Legacy `"agent"` DB rows keep working unchanged: `agent` stays a valid id
  with tightened semantics (dangerous deletions now denied; full bypass
  moves to `turbo`). No DB migration (plain TEXT column, no CHECK).
- Enforcement lives in the Claude SDK router (`canUseTool`), one branch
  per mode:
  - plan: unchanged (SDK plan permissionMode + md-only edit rule).
  - ask: NEW — Edit/Write/NotebookEdit/MultiEdit/Bash prompt the user via
    an `ask-user-question` Allow/Deny round-trip (same chunk + UI + mutation
    path the native runtime permission flow already reuses). 60s timeout
    denies.
  - edit: file edits auto-allowed; dangerous deletions denied.
  - agent: everything except dangerous deletions (ex-sylvain `auto` minus
    the Opus gate; `detectDangerousDeletion` ported and reworded).
  - turbo: current agent behavior (bypassPermissions + skip, no guards).
- SDK `permissionMode` stays `plan | bypassPermissions`; all gating flows
  through `canUseTool` (single path, consistent UI).
- UI: mode dropdowns render all 5 modes from one `mode-display` helper
  (label/icon/tooltip); Shift+Tab cycles in autonomy order; send-button
  keeps plan=orange; slash commands gain `/ask` `/edit` `/turbo` and hide
  the current mode generically.
- Mode-switch DB-write failure reverts to the actual previous mode
  (today it toggles plan<->agent, wrong for 5 modes).
- Non-enforcing providers (codex/cursor/gemini/openrouter/ACP/remote) and
  the native runtime accept the widened enum but keep current behavior;
  plan-on-native still fails with its existing message. Real per-provider
  enforcement is a follow-up, not this change.

## Non-goals
- Opus gating, per-model mode filtering.
- Per-provider (non-Claude) permission enforcement.
- DB migration; storage-key changes.

## Follow-ups (not this change)
- Native runtime permission answers: when the bridge gains the permissions
  capability, `handleQuestionsAnswer` must map a picked "Deny" option to
  `approved: false` for `native:`-prefixed toolUseIds (the dialog submits
  `approved: true` with the label in `answers`; the Claude ask-mode branch
  interprets this server-side, but `runtime.respondApproval` takes only a
  boolean).
- Per-provider (codex/cursor/gemini/openrouter/ACP) enforcement of
  ask/edit/agent/turbo; remote backend only knows plan/agent (header
  collapses non-plan modes).
