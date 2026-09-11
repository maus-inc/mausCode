# Change: add-native-session-init

## Why

On the legacy path the first thing a session emits is `session-init`: the tool
list, MCP servers, plugins, and skills that populate the session-info panels.
P1 deliberately skipped it on native, so native sessions show empty/stale
panels (whatever the last legacy session left in `sessionInfoAtom`) — wrong
information presented as current. This change gives native sessions an honest
session-init.

## What changes

- The daemon host derives the native session's capability snapshot (tools, MCP
  servers, plugins, skills) from the harness session and emits a `session-init`
  chunk in the same shape the renderer already consumes.
- The native transport feeds it to `sessionInfoAtom` exactly like the legacy
  transport (shared handling; no transport-specific panels).
- Staleness rule: switching engines on an empty chat clears or replaces the
  snapshot so panels never show another engine's data. (Engine switching is
  already limited to empty chats; this change defines what the panels show then.)
- If the harness cannot enumerate some category (e.g. skills), the snapshot
  marks it unknown rather than empty — the UI distinguishes "none" from
  "not reported".

## Non-goals

- No new panels or UI redesign.
- No MCP/plugin/skill feature work (this change only reports what's there;
  passthrough is `add-native-mcp-passthrough`).
- No backfill of legacy snapshots.

## Impact

- Small and additive: one chunk emission + shared atom handling.
- Kills a real misinformation bug (stale legacy panels shown for native
  sessions) rather than adding a feature.
- Approval requested before implementation.
