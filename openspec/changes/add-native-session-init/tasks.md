# Tasks: add-native-session-init

## Proposal

- [ ] Human approves this proposal (gate for implementation)
- [ ] Run `openspec validate add-native-session-init --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Implementation

- [ ] Derive the native capability snapshot from the harness session
- [ ] Emit `session-init` in the renderer-consumed shape on native session start
- [ ] Feed it to `sessionInfoAtom` via shared transport handling
- [ ] Engine-switch staleness rule (panels never show another engine's data)
- [ ] Unknown-vs-empty marking for categories the harness can't enumerate
- [ ] Unit + live tests for snapshot shape and staleness behavior
- [ ] Update second-brain + task states
