# Design: runtime permissions patch

## Context

System map §17 (seams), protocol v0, P1 approval wiring (translator synthesis +
`runtime.respondApproval`, currently dormant). First behavioral patch on the
vendored tree; also sets the patch-workflow precedent. PA-3 ratified
2026-09-11; proposal approved with scope=all.

Exploration findings (all paths under `runtime/jcode/`, stock at ce4e789):

- Interactive sessions NEVER pause for permission today: the only enforcement
  is the deterministic destructive-command gate (`app-core/.../tool/
  bash_destructive_gate.rs`, deny/reflect, no user interaction).
- `jcode-base::safety::SafetySystem` (queue + file-persisted history) serves
  ambient mode only: the sole production `request_permission` caller is the
  ambient `RequestPermissionTool` (`app-core/.../tool/ambient.rs:683`), which
  returns `Queued` immediately — nothing waits.
- The harness v1 wire kinds ALREADY exist: `ApiEvent::PermissionRequest`
  (`harness-api/src/events.rs:147`) and `ApiRequest::PermissionResponse` with
  `Allow/AllowAlways/Deny` (`harness-api/src/requests.rs:109`). The bridge
  answers `permission_response` with an honest "no `permissions` capability"
  error (`harness-api-server/src/translate.rs:920`) and advertises no such
  capability (`harness-api-server/src/lib.rs:278`).
- The TS client (`packages/runtime-client`) is fully permission-ready
  (`respondToPermission`, auto-answer hook, event types). No client changes.
- The app (P1) is fully wired (synthesis + `respondApproval` +
  `status.supportsPermissions`). No app changes until live verification.

## Shape (decided): Option B by evidence

The scaffold recommended Option A (`maus.*` kinds). Exploration overturned it:
upstream already specified the exact wire shape, so inventing parallel kinds
would fork the protocol for zero gain. The patch implements the specified
surface: daemon emission + bridge relay + capability advertisement, with
`API_VERSION_MINOR` 0→1 (additive per the crate's own versioning rule).
`docs/protocol.md` documents the behavior in the same change. I-3 holds: stock
clients ignore the newly advertised capability gracefully (capability-gated by
contract), and the legacy-protocol additions are internal-only.

## Core design: mirror the stdin flow exactly

The daemon already solves this exact problem for stdin (`StdinInputRequest` →
`ServerEvent::StdinRequest` → `Request::StdinResponse` → oneshot resume in
`tool::bash`). The permission patch copies that proven shape instead of
inventing one:

1. `jcode-tool-core/src/lib.rs`: add `PermissionInputRequest { request_id,
   tool_name, description, response_tx: oneshot::Sender<PermissionDecision> }`;
   add `permission_request_tx` to `ToolContext` (+ `for_subcall` clone).
2. `app-core/src/tool/mod.rs` `ToolRegistry::execute` (the single choke point
   for ALL tool execution): after the session-policy and `pre_tool` hook
   checks, consult the session permission policy; if the tool gates, send the
   request and await the oneshot with timeout. Allow/AllowAlways proceed
   (Always records a session allow entry); Deny, timeout, or dead receiver
   return a typed error the agent can replan on.
3. `app-core/src/tool/mod.rs` `SessionToolPolicy`: add permission mode
   (`standard` | `read-only`) + allow-always entries; extend
   `register_session_tool_policy` (callers: `agent.rs:301`,
   `turn_execution.rs:215,689`). Read-only mode is what unblocks native plan
   mode: every mutation gates, reads (the `AUTO_ALLOWED` set in
   `jcode-base/src/safety.rs` + risk-gate immediates) proceed.
4. `jcode-protocol/src/wire.rs`: add `ServerEvent::PermissionRequested
   { request_id, tool_name, description, ... }` and
   `Request::PermissionDecision { id, request_id, decision }` (internal
   protocol — free to extend).
5. `app-core/src/server/client_lifecycle.rs`: permission forwarder task
   mirroring `stdin_forwarder` (~754-780) + `Request::PermissionDecision` arm
   mirroring `Request::StdinResponse` (~2132) + oneshot map; agent gains
   `set_permission_request_tx` (mirror `set_stdin_request_tx`).
6. `harness-api-server/src/translate.rs`: map legacy `permission_requested` →
   `ApiEvent::PermissionRequest`; map harness `permission_response` → legacy
   `permission_decision` + `Ok` reply (replacing the honest-error arm ~920).
7. `harness-api-server/src/lib.rs`: add `"permissions"` to the hello
   capability list (~278).
8. `SafetySystem::record_decision` on every answer (audit history — the queue
   files become the decision log, consistent with ambient).
9. `UPSTREAM.md` patch-list entry; `capability_coverage` LEDGER disposition
   for the new internal request; `API_VERSION_MINOR` bump + note.

Deny-by-default falls out of the shape: timeout→deny, detached client (dead
oneshot receiver)→deny, unknown/expired id→rejected with no state change.
Failing closed is structural, not a flag.

## What stays out

- No changes to the deterministic destructive gate (it keeps refusing
  catastrophic commands outright — permission prompts must never offer "allow"
  for `rm -rf ~`).
- No `pre_tool` hook changes; no ambient-flow changes.
- No renderer changes: existing AskUserQuestion cards are the UI, already wired.

## Test plan (live, against the patched vendor; CI/dev-owned)

- Destructive command pauses: agent attempts gated op; card appears; deny →
  typed tool error → agent replans. (Catastrophic commands still hard-refused
  by the deterministic gate — separate assertion.)
- Allow / AllowAlways (second identical call proceeds without prompting).
- Timeout→deny; detach→immediate deny; unknown-id→rejected.
- Plan mode: read-only session gates writes, reads proceed ungated.
- `cargo test -p jcode-harness-api` + bridge tests + `packages/runtime-client`
  suite all green; approval latency recorded in `.dump/app/benchmarks/`.
