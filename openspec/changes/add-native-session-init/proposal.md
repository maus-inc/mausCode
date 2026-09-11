# Change: add-native-session-init

## Why

On the legacy path the first thing a session emits is `session-init`: the tool
list, MCP servers, plugins, and skills that populate the session-info panels.
P1 deliberately skipped it on native, so native sessions show empty/stale
panels (whatever the last legacy session left in `sessionInfoAtom`) — wrong
information presented as current. This change gives native sessions an honest
session-init.

## What changes

- On every native chat start (after session attach, before the turn), main
  emits a `session-init` chunk in the same shape the renderer already consumes:
  MCP servers from the Phase 1 snapshot (`add-native-mcp-passthrough`),
  `tools` carrying cached `mcp__server__tool` names, `plugins: []`,
  `skills: []`.
- Honest unknown marking: the v1 harness exposes no tool list, so the chunk
  sets `toolsUnknown: true` (additive optional field; legacy omits it). The
  MCP widget shows an "unavailable until the runtime reports it" note instead
  of presenting the partial list as complete. Config-file errors travel in
  `mcpConfigErrors` and render as warnings. The snapshot is best-effort: a
  resolution failure never fails the turn.
- The native transport feeds the chunk to `sessionInfoAtom` exactly like the
  legacy transport (same atom, same panels, no transport-specific rendering).
- Staleness rule: the engine toggle clears `sessionInfoAtom` (the next send's
  session-init repopulates it), and legacy session-inits overwrite the whole
  atom, so panels never show another engine's data. The engine badge itself
  already exists in the input area — no new chrome.
- `RuntimeManager` gains a `jcodeHome` getter so the snapshot reads the same
  global config + schema cache the daemon uses.

## Non-goals

- No new panels or UI redesign.
- No MCP/plugin/skill feature work (this change only reports what's there;
  resolution is `add-native-mcp-passthrough`, live relay is its Phase 2).
- No Rust changes.

## Impact

- Additive chunk/atom fields (optional; legacy path untouched).
- Snapshot emission is synchronous file reads on chat start (same files the
  daemon reads); failure-isolated from the turn.
