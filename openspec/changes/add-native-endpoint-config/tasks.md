# Tasks: add-native-endpoint-config

## Proposal

- [x] Human approves this proposal — approved 2026-09-11 (scope: all changes)
- [x] Routing-scope decision recorded: **daemon-level** (evidence: stock honors
      endpoint overrides ONLY via process env — `JCODE_OPENAI_API_BASE` /
      `OPENAI_BASE_URL` / `OPENAI_API_BASE`, `JCODE_ANTHROPIC_API_BASE` /
      `ANTHROPIC_BASE_URL`; `RouteSelection` is model-routing, not URLs; no
      per-session endpoint surface exists). Per-chat *different* endpoints on
      one daemon need a Rust session-scoped override — recorded as a future
      Rust phase, not implemented here.
- [ ] Run `openspec validate add-native-endpoint-config --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Implementation

- [x] `nativeEndpointSettings` singleton + migration `drizzle/0008_*`
- [x] Pure `endpoint-urls.ts` (normalize/match/honored/probe) + DB `endpoints.ts`
- [x] Credentials accept customBaseUrl iff honored, else loud refusal
- [x] Facade launch-env + `restartRuntime()`; nested `runtime.endpoints` router
      (get/set/probe; set aborts native turns + restarts daemon)
- [x] Settings UI section (two fields, save-on-blur, Test buttons, restart note)
- [x] Incidental: attach-before-credentials order, setModel retry
- [x] Tests: 6/6 pure + live stub-E2E turn (`stub-turn.test.ts`); tsc
      baseline-identical (99 = 99, zero in new files); main bundle builds,
      renderer fails only on the pre-existing `@shikijs` issue
- [x] Secret audit: probe is a credentialless GET; no credential logging
- [x] Update second-brain + task states
