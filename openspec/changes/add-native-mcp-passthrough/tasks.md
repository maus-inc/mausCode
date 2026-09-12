# Tasks: add-native-mcp-passthrough

## Proposal

- [x] Human approves this proposal — approved 2026-09-11 (scope: all changes)
- [x] Injection-mechanism decision recorded: **no injection needed** (evidence:
      daemon resolves project MCP itself at subscribe; the v1 harness has no
      MCP surface to inject through). Rescoped to Phase 1 (TS observability,
      this change) + Phase 2 (Rust `McpStatus`/tool-snapshot relay, future).
- [ ] Run `openspec validate add-native-mcp-passthrough --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Implementation (Phase 1)

- [x] `mcp-config.ts`: full `load_for_dir` mirror (5 layers, runnable rule,
      disabled-wins, claude.json per-project) + version-gated schema-cache read
- [x] Snapshot statuses connected/pending only; disabled omitted; file errors
      surfaced as config-failure notices
- [x] 7/7 fixture tests (precedence, runnable rule, claude.json, malformed
      tolerance, cache gating, snapshot mapping)
- [x] Consumed by the native session-init snapshot (see add-native-session-init)
- [ ] Cross-project isolation test (two projects, disjoint servers, no leakage)
      — open: needs a Rust-capable env to observe daemon-side pooling
- [x] Update second-brain + task states

## Phase 2 (future Rust — not implemented here)

- [ ] Bridge relay: surface `McpStatus` events + a per-session tool snapshot
      over the harness protocol (event + request arm, capability-gated)
- [ ] App consumes relay: live failed/needs-auth statuses, late tool registration
- [ ] Rust unit/integration tests in a Rust-capable environment
