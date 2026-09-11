# Tasks: add-native-endpoint-config

## Proposal

- [ ] Human approves this proposal (gate for implementation)
- [ ] Routing-scope decision recorded (per-chat override vs workspace routes)
- [ ] Run `openspec validate add-native-endpoint-config --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Implementation

- [ ] Daemon-launch endpoint route plumbing (named routes → env/config at start)
- [ ] Per-session route selection where the harness supports it
- [ ] Minimal settings UI: add/edit/remove/test endpoint routes
- [ ] Retire `NativeCredentialError` for covered endpoints; keep a clear error
      for uncovered ones (never silent fallback)
- [ ] Secret audit for the new config path (incl. test-connection flow)
- [ ] Unit + live tests for route resolution and refusal behavior
- [ ] Update second-brain + task states
