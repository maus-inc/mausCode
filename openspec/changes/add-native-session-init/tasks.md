# Tasks: add-native-session-init

## Proposal

- [x] Human approves this proposal — approved 2026-09-11 (scope: all changes)
- [ ] Run `openspec validate add-native-session-init --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Implementation

- [x] Emit native `session-init` on chat start (MCP Phase 1 servers + cached
      `mcp__` tool names + `toolsUnknown: true` + `mcpConfigErrors`)
- [x] Native transport feeds `sessionInfoAtom` (same atom/panels as legacy)
- [x] Engine toggle clears the snapshot; legacy overwrites it (no stale data)
- [x] Widget renders the unknown note + config-error warnings
- [x] `RuntimeManager.jcodeHome` getter; additive chunk/atom fields
- [x] Covered by the MCP mirror tests + live stub-E2E turn; tsc
      baseline-identical; main bundle builds
- [x] Update second-brain + task states
