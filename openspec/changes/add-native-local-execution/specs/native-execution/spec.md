# Capability: native-execution

## ADDED Requirements

### Requirement: App-managed local daemon

The application SHALL manage exactly one local runtime daemon per app instance:
spawn on first native use, health-check via `ping`, supervise across crashes with
backoff, keep alive while the app runs (no idle-kill), and shut down cleanly on quit.

#### Scenario: First native session starts the daemon

- WHEN a user sends the first message on a native-transport sub-chat with no daemon
  running
- THEN the app spawns the daemon, `ping` succeeds, and the turn streams without the
  user configuring any path.

#### Scenario: Daemon crash does not lose the session

- WHEN the daemon process dies mid-session
- THEN the app restarts it with backoff, re-attaches the session, surfaces a
  `runtime_status` notice, and the transcript remains intact.

### Requirement: Contract-compatible native chat

The native `runtime.chat` subscription SHALL accept the same input shape and emit the
same `UIMessageChunk` stream as the legacy chat path, so the renderer switches
transports without pipeline changes.

#### Scenario: Same UI renders both transports

- WHEN two sub-chats run the same prompt, one legacy and one native
- THEN both render through the identical message pipeline with no transport-specific
  components.

### Requirement: Daemon-owned session resume

Native session state SHALL live in the daemon; the app persists only the session id
mapping. Resume after window reload or app restart SHALL re-attach with full history.

#### Scenario: Window reload mid-session

- WHEN the renderer reloads while a native session is active
- THEN the reloaded UI re-attaches to the same daemon session and shows the full
  transcript without re-sending any prompt.

### Requirement: Reference-only credentials on the native path

Native sessions SHALL receive provider credentials exclusively via `set_api_key` over
the local socket at session start, resolved from existing credential stores. Tokens
SHALL NOT appear in router inputs, logs, or persisted transcripts.

#### Scenario: Audit a native session

- WHEN an auditor inspects router inputs, main-process logs, and the persisted
  transcript for a native session
- THEN no credential material appears; only provider ids and route names.

### Requirement: Deny-by-default approvals

Gated native tool actions SHALL pause for approval through the existing approval UI,
driven by `permission_request/response`. The default policy denies destructive,
network, and exfiltration classes; every allow rule has a test.

#### Scenario: Destructive command in agent mode

- WHEN the native agent attempts a destructive-class command
- THEN the action pauses, an approval card appears, and the command runs only after
  explicit approval (never by default).

### Requirement: Benchmark-gated parity

The native path SHALL NOT become the default until cold start, first-token latency,
session create/resume, and RSS (idle/loaded) are benchmarked against the legacy path
on the same workload, with results recorded and regressions blocking.

#### Scenario: Pre-default review

- WHEN a reviewer asks whether native can become the default
- THEN a benchmark record exists comparing both paths on identical workloads, and any
  regression beyond the agreed budget blocks the switch.
