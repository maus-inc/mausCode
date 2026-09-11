# Capability: runtime-protocol

## ADDED Requirements

### Requirement: Versioned NDJSON framing

The runtime protocol SHALL use newline-delimited JSON with explicit major versions
on every frame, a 16 MiB frame cap, and monotonic client request ids.

#### Scenario: Client sends a well-formed request

- WHEN a client writes `{"v":1,"id":7,"req":{"hello":{...}}}` plus newline to the
  runtime socket
- THEN the runtime responds with frames carrying `"v":1` and `"reply_to":7` for the
  direct reply.

#### Scenario: Oversized frame is rejected without unbounded buffering

- WHEN a client sends a line exceeding 16 MiB without a newline terminator
- THEN the runtime rejects the frame with an error and keeps serving other clients.

### Requirement: Additive evolution with Unknown tolerance

Clients and runtimes MUST ignore unknown fields and skip unknown `req`/`ev` kinds
without failing. Additive changes bump minor; breaking changes bump major and are
handshake-negotiated.

#### Scenario: Old client meets new runtime

- WHEN a v1.0 client receives an event kind introduced in v1.1
- THEN it skips the event and continues processing subsequent frames.

### Requirement: Session lifecycle surface

The protocol SHALL support create, attach, detach, fork, peek, clear, rewind,
rewind-undo, rename, archive, restore, retention-policy, list, and history
operations with daemon-owned session state that survives client disconnect.

#### Scenario: Client disconnects and reattaches

- WHEN a client disconnects mid-session and a new client attaches with the same
  session id
- THEN the session resumes with full transcript available via history.

### Requirement: Streaming agent turns

The protocol SHALL stream text deltas, reasoning deltas, tool lifecycle
(start/input-delta/exec/done), token usage, and turn completion, with cancel and
soft-interrupt (urgent and non-urgent) operations.

#### Scenario: User interrupts a running turn softly

- WHEN a soft_interrupt request arrives during tool execution
- THEN the runtime injects the message at the next safe point without discarding
  completed tool results.

### Requirement: Permission request/response

The runtime SHALL request approval for policy-gated actions and block only the
gated action (not the whole session) until the client responds. Default policy is
deny-by-default with explicit, tested allow rules.

#### Scenario: Gated tool awaits approval

- WHEN a tool call matches a requires-permission rule
- THEN the runtime emits permission_request, pauses that action, and resumes or
  aborts it exactly per the client's permission_response.

### Requirement: Credential references, never values

Provider credentials SHALL cross the protocol only as operations on references
(set/clear/list state), never as values inside call arguments, and SHALL NOT appear
in logs, telemetry, crash reports, or persisted transcripts.

#### Scenario: Audit a session transcript

- WHEN an auditor inspects a persisted transcript, runtime logs, and telemetry
  payloads for a session that used an API key
- THEN no key material appears in any of them; only provider ids and route names.

### Requirement: Namespaced maus extensions

mausCode-specific operations SHALL use `maus.*` request/event kinds, be additive
(minor-versioned), and be ignorable by clients that do not implement them. v0
reserves `maus.workspace`, `maus.device`, `maus.checkpoint`, `maus.taskgraph`,
`maus.doctor` without defining their payloads.

#### Scenario: Stock runtime meets extension request

- WHEN a client sends `maus.doctor` to a runtime that does not implement it
- THEN the runtime replies with an explicit unsupported-operation error, not a
  disconnect.

### Requirement: Transport rules

Local transport SHALL be NDJSON over a Unix socket (named pipe on Windows) with
socket paths resolved by one shared rule set. Remote transport SHALL carry the
same frames over TLS WebSocket at the node/relay boundary only.

#### Scenario: Desktop connects to a healthy local daemon

- WHEN the daemon is running and the client resolves the socket path via the shared
  rules
- THEN hello succeeds without manual path configuration.
