# Tasks: add-native-mcp-passthrough

## Proposal

- [ ] Human approves this proposal (gate for implementation)
- [ ] Injection-mechanism decision recorded (daemon config vs per-session
      attach) with the project-scoping argument
- [ ] Run `openspec validate add-native-mcp-passthrough --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Implementation

- [ ] Resolve project MCP config with legacy-identical files/precedence
- [ ] Inject resolved servers into native sessions per the chosen mechanism
- [ ] Renderer parity: MCP tools/panels identical across transports
- [ ] Per-server failure notices; session still starts when a server is down
- [ ] Cross-project isolation test (two projects, disjoint servers, no leakage)
- [ ] Unit + live tests for resolution, injection, and failure behavior
- [ ] Update second-brain + task states
