# Tasks: add-runtime-permissions

## Gates (all must pass before any implementation)

- [x] Human approves this proposal — approved 2026-09-11 (scope: all changes)
- [x] PA-3 vendor form ratified 2026-09-11 (copied tree + UPSTREAM.md + MIT
      notice, as assumed; see `decisions/provisional-assumptions.md`)
- [x] Capability-shape decision recorded: **Option B by evidence** — the wire
      kinds already exist upstream (`permission_request` event,
      `permission_response` request, Allow/AllowAlways/Deny in
      `jcode-harness-api`), so no `maus.*` kinds are needed; the patch is
      daemon emission + bridge relay + capability advertisement, with an
      `API_VERSION_MINOR` 0→1 bump. See design.md §Shape.
- [ ] Run `openspec validate add-runtime-permissions --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Rust patch (CI/dev-owned: no Rust toolchain or crates.io in sandbox 2026-09-11)

Stdin-mirror spec in design.md; file-by-file:

- [ ] `jcode-tool-core`: `PermissionInputRequest` + `ToolContext.permission_request_tx`
- [ ] `ToolRegistry::execute`: pause point (policy consult → await oneshot w/
      timeout → typed deny error); extend `SessionToolPolicy` (permission mode
      + allow-always) + `register_session_tool_policy` call sites
- [ ] `jcode-protocol`: `ServerEvent::PermissionRequested` +
      `Request::PermissionDecision`
- [ ] `client_lifecycle.rs`: forwarder task + decision arm + oneshot map
      (mirror stdin, ~754-780 and ~2132)
- [ ] Bridge `translate.rs`: legacy→`ApiEvent::PermissionRequest`;
      `permission_response`→legacy decision + Ok (replace ~920 honest-error arm)
- [ ] Bridge `lib.rs`: advertise `"permissions"` (~278)
- [ ] `API_VERSION_MINOR` 0→1 + `capability_coverage` LEDGER disposition
- [ ] `record_decision` audit on every answer; UPSTREAM.md patch-list entry;
      `cargo test -p jcode-harness-api` + bridge tests green

## Client + protocol docs

- [x] `packages/runtime-client`: NO CHANGES NEEDED — verified 2026-09-11 that
      `respondToPermission`, auto-answer, and `permission_request` event types
      already exist (P1 uses them)
- [ ] `docs/protocol.md`: document the capability + behavior (minor-version
      note, not `maus.*` — see design.md §Shape)

## App activation + verification (live, against the patched vendor)

- [x] App wiring already complete in P1 (synthesis + `respondApproval` +
      `status.supportsPermissions`) — activation = verify live, no new code
- [ ] Verify dormant P1 wiring live: card appears, allow/deny round-trips
- [ ] Timeout-deny, detach-deny, unknown-id rejection exercised (not code-read)
- [ ] Plan mode on native: enforce read-only via session policy; else
      explicitly re-confirm the refusal with rationale
- [ ] Benchmarks: approval latency (request→card→resume) recorded in
      `.dump/app/benchmarks/`; regressions block
- [ ] Update second-brain + task states
