# Capability: runtime-permissions

## ADDED Requirements

### Requirement: Permissions capability advertisement

The runtime SHALL advertise a `permissions` capability at handshake when (and
only when) it can pause tool execution and issue `permission_request` events.
Clients SHALL key approval behavior off the advertised capability, never off
the runtime version string.

#### Scenario: Stock runtime stays silent

- WHEN the app handshakes a runtime without the patched capability
- THEN no `permissions` capability is advertised and the app issues no approval
  UI for that session (current dormant behavior, preserved).

#### Scenario: Patched runtime advertises

- WHEN the app handshakes the patched runtime
- THEN the `permissions` capability is present and the app enables the
  approval path for sessions on that runtime.

### Requirement: Pause-and-ask on gated operations

For every gated operation, the bridge SHALL pause the tool call and emit a
`permission_request` carrying the fully-resolved operation (paths, command,
target) before anything executes. The call SHALL resume only on an explicit
allow for that request id.

#### Scenario: Destructive command pauses

- WHEN the agent attempts a gated operation (e.g. recursive delete outside the
  workspace root)
- THEN the tool call pauses, a `permission_request` is emitted, and nothing
  executes until the user answers.

#### Scenario: Allow resumes, deny fails typed

- WHEN the user allows the request
- THEN the tool call resumes and the transcript records the decision.
- WHEN the user denies the request
- THEN the tool call fails with a typed permission-denied error visible to the
  agent (so it can replan), and nothing executes.

### Requirement: Deny-by-default

Unanswered requests SHALL deny on timeout; requests with no attached answerer
(detached client) SHALL deny immediately; responses naming unknown or expired
request ids SHALL be rejected with no state change. Failing closed is not
configurable.

#### Scenario: Timeout denies

- WHEN a `permission_request` goes unanswered past the session timeout
- THEN the tool call fails with a typed `permission_timeout` error and nothing
  executes.

#### Scenario: Detach denies immediately

- WHEN the answering client detaches while a request is pending
- THEN the request is denied at once (no waiting for the timeout).

### Requirement: Read-only session policy

Sessions SHALL accept a policy of `standard` or `read-only` at create/attach.
Under `read-only`, every mutating operation SHALL gate; reads SHALL proceed
ungated. The runtime SHALL expose a machine-readable policy description so app
UI copy never hardcodes policy text.

#### Scenario: Plan mode enforcement

- WHEN a native plan-mode session (read-only policy) attempts a file write
- THEN the write gates for approval while reads in the same turn proceed
  without prompts.
