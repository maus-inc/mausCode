# Port T3 codex-app-server client; replace the ACP hop (adapter only)

## Why
Codex chats today run through Zed's `codex-acp` adapter + an AI-SDK shim,
a translation hop that costs fidelity (we carry a tool normalizer and a
text-delta coalescer as workarounds) and hides native capabilities (thread
resume/fork/rollback, turn interrupt/steer, reviews, guardian approvals).
The Phase 5 spike verified T3's typed app-server client runs in our
toolchain (36/36 incl. live stdio mock-peer round-trip) with verdict ADOPT.
See `.dump/app/research/phase5-codex-app-server-spike.md`.

## What changes
- Port `packages/effect-codex-app-server` (18 files + tests) to
  `src/main/lib/codex-app-server/` (Effect-isolated, main-process only),
  MIT attribution preserved. Generated schema refreshed from current
  upstream if the generator runs, else July port (client tolerates unknown
  server methods via `handleUnknownServer*`).
- Promote `@effect/platform-node[-shared]` (exact RC pins) to runtime deps
  (spawner layer); remove `codex-acp` + `acp-ai-provider` deps after parity.
- Rewrite the codex router transport: app-server sessions keyed by the same
  fingerprints (cwd/auth/mcp/effort), `thread/start|resume` + `turn/start`,
  app-server events mapped onto the EXISTING chunk shapes. tRPC surface and
  renderer untouched. Login (`codex login` spawn), usage polling, MCP
  config, cancel/cleanup, auth-error mapping, persistence all preserved.

## Non-goals
- codex-on-native (WONTFIX unchanged — adapter only, no OAuth provisioning).
- New user-facing Codex features (resume/fork UI etc. unlock later).
- Live-CLI verification in sandbox (no `codex` binary here; compat gate
  documented for build env).
