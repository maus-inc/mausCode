# Capability: codex-native-support

> This spec describes the SUPPORT end state. If the recorded decision is
> WONTFIX, this change closes with decision records only and this spec does
> not apply.

## ADDED Requirements

### Requirement: Codex-backed native sessions

Codex-backed conversations SHALL be servable through the native engine with
turn behavior identical to claude-code-backed native turns from the renderer's
perspective (same chunks, same cards, same queue).

#### Scenario: Codex chat goes native

- WHEN a user flips a codex sub-chat to the native engine and sends a message
- THEN the turn streams through the daemon with the Codex backing and renders
  through the identical message pipeline.

### Requirement: Ref-only Codex credentials

Codex authentication for native sessions SHALL NOT depend on an exportable
key. Credentials SHALL resolve through the existing ref-only path and SHALL
NOT appear in router inputs, logs, or persisted transcripts.

#### Scenario: Audit a Codex-backed native session

- WHEN an auditor inspects router inputs, main-process logs, and the persisted
  transcript for a Codex-backed native session
- THEN no credential material appears; only provider ids and route names.

### Requirement: Honest toggle availability

The engine toggle SHALL be enabled for codex chats exactly when Codex-backed
native sessions are supported, and SHALL otherwise be disabled with copy that
states the actual reason (not a generic "unavailable").

#### Scenario: Toggle reflects reality

- WHEN Codex-backed native sessions are unsupported
- THEN the toggle on a codex chat is disabled and its copy says Codex is not
  supported on the native engine yet.
- WHEN support ships
- THEN the toggle on a codex chat is enabled.
