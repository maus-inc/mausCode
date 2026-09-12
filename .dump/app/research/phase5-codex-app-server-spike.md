# Phase 5 spike: T3 effect-codex-app-server as Codex-adapter upgrade (2026-09-11)

Provenance: evaluation spike run by app-track agent under user-approved T3
FULL-ADOPT (Phase 5 = evaluation, not committed). Source:
`pingdotgg/t3code` `packages/effect-codex-app-server` @ `211618f` (MIT),
fetched to `refs/harvest/t3code`.

## What it is
Typed Effect client for the Codex **app-server protocol** (JSON-RPC over
stdio, spawned as `codex app-server`): 18 files — `client`/`protocol`/`rpc`/
`schema`/`errors`, generated Schema from openai/codex
`codex-rs/app-server-protocol` @ `678157ac` (2026-07-19), mock peer +
live probe example. 82 typed methods: thread lifecycle
(start/resume/fork/rollback/archive/compact), turn control
(start/interrupt/steer), review/start, guardian exec approvals, skills,
models, config, fs, hooks, MCP status, account.

## What we have today
`src/main/lib/trpc/routers/codex.ts` drives Codex through Zed's `codex-acp`
adapter (`@zed-industries/codex-acp@0.15.0`) + `@mcpc-tech/acp-ai-provider`,
consumed via AI-SDK `streamText`. Login/usage stay on direct CLI spawn
(`codex login`, `login status`). We carry ACP-translation workarounds
(tool normalizer, text-delta coalescer).

## Spike result: package RUNS in our toolchain (verified, then removed)
- Ported all 18 files to a scratch dir (deleted after): `vitest` 36/36,
  including `client.test.ts` which spawns the mock peer over real stdio
  and runs initialize + `account/read` + `skills/list` + server-request
  handling.
- Runtime needs only `effect` (already adopted, Phase 4). Tests/probe need
  `@effect/platform-node` for the spawner layer.
- RC-skew witnessed LIVE: transitive `@effect/platform-node-shared@rc.114`
  vs `effect@rc.112` broke 2 suites (`effect/dist/ByteSize.js` missing);
  fixed by pinning shared to rc.112. Lesson: pin EVERY `@effect/*`
  transitive exact; use npm overrides if a caret escapes again. The pins
  are left in `package.json` devDeps for the port.

## Verdict: ADOPT as a follow-up port (not this spike)
- Fit: our bundled Codex CLI already ships `app-server`; the client removes
  the ACP translation hop (kills the normalizer/coalescer workaround class)
  and unlocks thread resume/fork/rollback, turn interrupt/steer, reviews,
  guardian approvals — all unavailable through the ACP subset.
- Scope: port 18 files to `src/main/lib/codex-app-server/` (Effect-isolated,
  main-process only); rewrite the codex.ts transport/session/stream loop
  onto the client; KEEP the tRPC surface + renderer untouched. Login stays
  CLI-spawn; usage polling stays. Remove codex-acp deps only after parity.
- Gates before porting: (1) probe the ACTUAL bundled CLI version against
  the 2026-07-19 schema ref (regenerate from a newer ref if drifted —
  dev-time only, needs network + `@effect/openapi-generator`); (2) parity
  checklist (streaming, MCP tools, reasoning effort, login, usage).
- Does NOT reopen codex-on-native WONTFIX: adapter only, no OAuth
  provisioning through the harness.
- Effort: medium (one router's transport + tests), de-risked by the mock
  peer and the now-pinned toolchain.
