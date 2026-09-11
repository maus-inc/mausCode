# Design: runtime-protocol v0

## Context

Full analysis: `.dump/app/research/current-system-map.md` (§16–17),
`.dump/app/plans/mauscode-architecture-plan.md` (§3–6). This document contains only
what the spec needs plus rejected alternatives.

## Adopt, don't invent

Upstream `jcode-harness-api` v1 is adopted verbatim as the wire core:

- NDJSON: one JSON object per line, both directions. 16 MiB frame cap (upstream value).
- Client→server: `{v: 1, id: u64, req: {...}}`. Server→client:
  `{v: 1, reply_to?: u64, ev: {...}}`. `id` monotonic per connection; streaming events
  omit `reply_to`.
- Unknown fields ignored; unknown `req`/`ev` kinds map to `Unknown` and are skipped,
  never fatal. Minor = additive, Major = breaking + handshake negotiation.
- Adopted kinds: hello, list/archive/restore/retention/create/attach/fork/detach/peek/
  clear/rewind(+undo)/rename sessions; send_message, cancel, soft_interrupt(+cancel);
  permission_request/response; list_models/set_model/set_reasoning_effort; runtime_info;
  set/clear_api_key; read_file/find_files/search_text/file_status; compact; ping/pong;
  text/reasoning deltas; tool_start/input_delta/exec/done; images; token_usage;
  turn_done; session_status; connection_phase; models/runtime info; credential_updated;
  files/matches/status; compacted; renamed; ok/error.

## maus.* extensions (additive, namespaced, minor-versioned)

Reserved in v0, defined fully in follow-up changes. No implementation here.

- `maus.workspace` — spawn/describe/move workspace (placement, home_mode, env policy).
- `maus.device` — register/challenge/heartbeat/capabilities/revoke/upgrade.
- `maus.checkpoint` — atomic transcript+tree checkpoint.
- `maus.taskgraph` — subscribe/patch task DAG.
- `maus.doctor` — structured diagnostics; secrets redacted by construction.

## Transports

- Local: NDJSON over Unix socket (Windows: named pipe), socket paths resolved by the
  shared-rules module (single definition used by daemon, bridge, and clients — the
  bug class upstream already fixed once in `sockets.rs` must not be reintroduced).
- Remote (node/relay boundary only): same frames over TLS WebSocket. No HTTP/REST
  translation layer for the hot path; HTTP exists only where relay infrastructure
  demands it. Rationale: per-chunk HTTP overhead on a streaming protocol is pure tax.

## Security posture (binding on implementations)

- Credentials are references at every boundary. No token in call args, logs,
  telemetry, crash reports, or persisted protocol transcripts.
- Permission policy is deny-by-default with explicit allow rules; every allow rule
  needs a test. The inherited `bypassPermissions` default is never ported.
- `pre_tool` hook budget default 5s (upstream value); unknown-host-key refusal and
  non-interactive SSH are mandatory for the SSH placement.
- Imported foreign transcripts are untrusted input (provenance-marked, never
  auto-executed).

## Explicitly deferred

- PTY/terminal in protocol: the 1Code terminal manager stays local; remote PTY arrives
  via placement-native channels (SSH exec channel first). Reason: PTY framing,
  flow-control, and reattach semantics deserve their own proposal.
- Git in protocol: the hardened `src/main/lib/git/` engine stays in the app; remote
  git arrives with node-side execution. Reason: same as above, plus the local engine
  is already correct.
- Swarm/ambient/overnight defaults, Gmail/computer-use tools: keep compiling in the
  vendored runtime, disabled by default, curated per-workspace allowlist later.

## Rejected alternatives

- New bespoke wire format: rejected — doubles integration work and strands us from
  upstream fixes and the existing TS SDK.
- HTTP/REST for local IPC: rejected — framing + streaming overhead with zero benefit
  over a socket; tRPC-over-IPC stays for app-internal calls only.
- tRPC end-to-end to the runtime: rejected — couples the runtime to the Electron/TS
  stack and forecloses non-TS runtimes and the existing Rust/TS SDK pair.
- Adopting the legacy internal `jcode-protocol` instead of harness v1: rejected —
  unversioned, TUI-coupled, explicitly superseded by upstream's own rewrite.
