# mausCode runtime protocol v0

Status: normative for the application↔runtime boundary. Change control: OpenSpec
(`runtime-protocol` capability). Rationale and rejected alternatives live in
`openspec/changes/add-runtime-protocol-v0/design.md`, not here.

## 1. Wire core

The wire core is JCode `harness-api` v1, adopted verbatim:

- NDJSON, one JSON object per line, both directions. Maximum frame: 16 MiB; a line
  exceeding the cap without a terminator is rejected with an error. The peer keeps
  serving other connections.
- Client→server: `{"v":1,"id":<u64>,"req":{...}}`. `id` is monotonic per connection.
- Server→client: `{"v":1,"reply_to":<u64>?,"ev":{...}}`. Direct replies carry
  `reply_to`; streaming events omit it.
- Unknown fields are ignored. Unknown `req`/`ev` kinds map to `Unknown` and are
  skipped, never fatal. Additive changes bump minor; breaking changes bump major
  and are negotiated in the handshake (`hello`).

## 2. Adopted surface

Sessions: list, create, attach, detach, fork, peek, clear, rewind, rewind-undo,
rename, archive, restore, retention-policy, history. Sessions are daemon-owned and
survive client disconnect; re-attach resumes with full transcript.

Turns: send_message, cancel, soft_interrupt (+cancel_soft_interrupts). Streaming:
text/reasoning deltas, tool_start/tool_input_delta/tool_exec/tool_done, images,
token_usage, turn_done, session_status, connection_phase.

Models/providers: list_models, set_model, set_reasoning_effort, model_info/models,
runtime_info, set_api_key, clear_api_key, credential_updated.

Files (session-scoped): read_file, find_files, search_text, file_status (+ file_content,
files, text_matches events).

Maintenance: compact (+compacted), ping/pong, ok/error. Error codes: `internal`,
`invalid_request`, `unknown_request`, `unknown_session`, `unsupported_version`.

## 3. maus.* extensions

mausCode-specific operations use `maus.*` request/event kinds. All extensions are
additive (minor-versioned) and ignorable by clients that do not implement them. A
runtime that does not implement an extension replies with an explicit
unsupported-operation error; it never disconnects.

v0 reserves these names without defining payloads (each gets a follow-up change):

- `maus.workspace` — spawn/describe/move workspace (placement, home_mode, env policy).
- `maus.device` — register/challenge/heartbeat/capabilities/revoke/upgrade.
- `maus.checkpoint` — atomic transcript+tree checkpoint.
- `maus.taskgraph` — subscribe/patch task DAG.
- `maus.doctor` — structured diagnostics; secrets redacted by construction.

## 4. Transports

- Local: NDJSON over a Unix socket (named pipe on Windows). Socket paths are resolved
  by exactly one shared rule set used by daemon, bridge, and every client.
- Remote: the same frames over TLS WebSocket, at the node/relay boundary only. No
  HTTP/REST translation on the hot path.

## 5. Security invariants (binding)

- Credentials cross the protocol only as reference operations, never as values in
  call arguments. No key material in logs, telemetry, crash reports, or persisted
  transcripts.
- Permission policy is deny-by-default with explicit, tested allow rules. Gated
  actions pause individually; the session continues. The inherited
  `bypassPermissions` default is never ported.
- `pre_tool` hook budget default 5s. SSH placement: non-interactive, unknown-host-key
  refusal mandatory.
- Imported foreign transcripts are untrusted input: provenance-marked, never
  auto-executed.

## 6. Explicitly out of v0

PTY/terminal framing, git operations, swarm/ambient scheduling, and any HTTP API are
not part of v0. Each requires its own proposal.
