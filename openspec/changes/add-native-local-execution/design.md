# Design: native local execution

## Context

System map §17 (seams), architecture plan P1, protocol v0. This change is the first
runtime consumer inside the app.

## Why additive, not replacement

Replacing `claude.chat` in place would couple the new runtime host to every renderer
quirk of the legacy path and make benchmarks A/B impossible. Instead the `runtime`
router mirrors the `claude.chat` contract (same zod input shape, same `UIMessageChunk`
output) so the renderer switches one transport flag. Retirement of legacy paths is a
separate, later change gated on benchmark parity.

## Translation, not renderer rewrite

`translate.ts` maps harness `ApiEvent`s onto the existing `UIMessageChunk` stream
(text/reasoning deltas, tool lifecycle, usage, permission requests, errors,
compacted/renamed notices). Rationale: the renderer's message pipeline, tool cards,
queue, and approval UI are proven product modules (system map §1/§4); churning them
before the runtime is proven would mix two failure domains. A native event UI is a
later refinement once translation parity is measured.

## Session authority moves to the daemon

Today `activeSessions`/`activeStreams` live in main-process memory and die with the
app or a hung window. Native sessions are daemon-owned: `subChats.sessionId` becomes
the JCode session id, resume is `attach`, and the DB row keeps metadata only. The
messages JSON blob keeps being written during P1 (rollback safety + legacy readers);
cutting it over is a follow-up once daemon transcripts are the proven source of truth.

## Credential flow

P1 reuses existing credential stores (Anthropic accounts, Codex login, Ollama/custom
endpoints) and applies them via `set_api_key` over the local socket at session start.
`customConfig.token`-in-args is forbidden on the native path from day one. Remote
forwarding and rotation events belong to the BYOK change, not this one.

## Daemon binary resolution (dev vs packaged)

- Dev: prefer the pinned npm platform binary (same one `runtime-client` live tests
  use) so `bun run dev` needs no Rust toolchain. `cargo run` against the vendored
  tree is supported for runtime development.
- Packaged: bundle the runtime binary per platform (electron-builder extraResources);
  the host resolves it from `process.resourcesPath`.
- No idle-kill while the app runs; idle-kill only for headless node use. Crash →
  supervised restart with backoff + renderer-visible `runtime_status` event.

## Permission policy posture

Harness `permission_request/response` drives the existing approval cards. Policy starts
deny-by-default for destructive/network/exfil classes with a minimal explicit allow
list; every allow rule ships with a test. The legacy `bypassPermissions` semantics are
never ported. Full policy matrix is owned by the later hardening change; P1 needs just
enough to run real sessions safely.

## Rejected alternatives

- In-place `claude.chat` rewrite: rejected (no A/B, mixes failure domains).
- New renderer message pipeline now: rejected (translation preserves proven UI).
- Daemon-per-window: rejected (sessions are app-scoped; one daemon per app instance,
  matching upstream's single-server model).
- Skipping the benchmark gate: rejected (I-6; the native claim must be measured).
