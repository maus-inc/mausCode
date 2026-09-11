# Capability: native-session-init

## ADDED Requirements

### Requirement: Native capability snapshot on session start

Native sessions SHALL emit a `session-init` chunk in the same shape the
renderer consumes on legacy, carrying the session's tools, MCP servers,
plugins, and skills. The native transport SHALL feed it to the session-info
state through the same handling as legacy.

#### Scenario: Panels populate on native

- WHEN a native session starts
- THEN the session-info panels show that session's tools, MCP servers,
  plugins, and skills with no transport-specific UI.

### Requirement: No cross-engine staleness

Session-info panels SHALL never display one engine's snapshot for a session
running on the other engine. Switching engines (empty chats only) SHALL clear
or replace the snapshot before the next turn renders.

#### Scenario: Flip engine on an empty chat

- WHEN a user flips an empty chat from legacy to native and sends the first
  message
- THEN the panels show the native snapshot, never the previous legacy one.

### Requirement: Unknown distinguished from empty

Categories the harness cannot enumerate SHALL be marked unknown, not reported
as empty. The UI SHALL distinguish "none configured" from "not reported".

#### Scenario: Skills not enumerable

- WHEN the harness cannot enumerate skills for a native session
- THEN the skills panel shows a not-reported state rather than an empty list.
