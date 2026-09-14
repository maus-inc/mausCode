# mausCode architecture plan

Status: draft for implementation. Source-of-truth inputs: `../research/product-thesis.md`,
`../research/current-system-map.md`, `../research/competitive-capabilities.md`,
`../research/migration-system.md`. Protocol details will graduate to `docs/protocol.md`
via an OpenSpec proposal before code lands.

## 1. Target shape

```
mausCode (Electron app)
├── app shell (inherited UI, progressively refined)
├── application layer (tRPC routers as thin adapters, NOT execution owners)
├── runtime client (harness-api v1 NDJSON client in Electron main)
├── mausCode runtime (refined JCode: daemon + harness bridge + node wrapper)
│   ├── local placement (spawned daemon, socket)
│   ├── SSH placement (remote daemon, tunneled socket)
│   ├── Docker placement (containerized node)
│   ├── Daytona placement (workspace node)
│   └── future placements (same node binary, new launcher)
└── compatibility adapters (Claude ACP, Codex ACP, OpenCode, Hermes)
    └── each implements AgentRuntime; none may leak into native types
```

Invariants:

- I-1. The UI never imports runtime internals; it speaks to the application layer,
  which speaks harness-api to exactly one runtime per workspace.
- I-2. A workspace (repo + runtime + sessions + env + git + provider + MCP/skills/
  instructions) is placement-independent: moving local→SSH→Daytona changes the
  launcher, never the workspace model.
- I-3. JCode stays independently usable (`serve`/`connect`/TS SDK); mausCode consumes
  it, never forks its protocol incompatibly without a major version + negotiation.
- I-4. No native-path feature may depend on a compatibility adapter's presence.
- I-5. Secrets are refs at every boundary; no token in call args, logs, telemetry,
  or crash reports. (`customConfig.token`-in-args dies in phase 1.)
- I-6. Every phase ships with benchmarks; regressions block (see §7).

## 2. Repo layout target (incremental, no flag-day moves)

```
runtime/jcode/            # vendored JCode (form TBD in decisions/), maus-owned patches
  UPSTREAM.md             # SHA, license (MIT, Jeremy Huang), patch list
packages/runtime-client/  # harness-api v1 TS client (fork of @1jehuang/jcode-sdk)
src/main/lib/runtime/     # Electron-main runtime host: daemon spawn, socket mgmt,
                          # translate (ApiEvent→UIMessageChunk), provider ref resolution
src/shared/protocol/      # shared TS types mirroring harness v1 + maus extensions
docs/protocol.md          # the contract (OpenSpec-managed)
benchmarks/               # harness + results (see .dump/app/benchmarks/)
```

`src/main/lib/trpc/routers/claude.ts` and `codex.ts` shrink to adapters over the
runtime client; `chats.ts` keeps product workflows (tabs/queue/diff/PR) and stops
owning execution.

## 3. Runtime boundary (harness v1 + maus extensions)

Adopt `jcode-harness-api` v1 as-is for: hello, sessions CRUD/fork/attach/detach/peek/
clear/rewind, send/cancel/soft-interrupt, permission req/resp, models, api keys,
file ops, compact, ping. mausCode extensions (new `req`/`ev` kinds, minor-versioned,
namespaced `maus.*`):

- `maus.workspace` (spawn/describe/move workspace; placement + home_mode + env policy)
- `maus.device` (register/challenge/heartbeat/capabilities/revoke/upgrade)
- `maus.checkpoint` (transcript+tree atomic checkpoint)
- `maus.taskgraph` (subscribe/patch task DAG)
- `maus.doctor` (structured diagnostics; secrets redacted by construction)

Terminal/PTY stays out of the protocol for now (local manager kept; remote PTY via
placement-native channels in later phases — SSH exec channel first).

## 4. Provider model (RuntimeProvider)

```ts
interface RuntimeProvider {
  id: "local" | "ssh" | "docker" | "daytona" | "remote" | string
  launch(ws: WorkspaceSpec): Promise<RuntimeHandle>   // ensure node, return socket
  status(handle): Promise<RuntimeHealth>              // from runtime_info + ping
  stop(handle): Promise<void>
}
interface RuntimeHandle { request(req): Promise<void>; events: AsyncIterable<ApiEvent> }
```

`local`: spawn `mauscode-node` (JCode daemon+bridge), socket in runtime dir, explicit
lifecycle (no idle-kill under a running app; idle-kill only headless).
`ssh`: reuse JCode `--ssh` attach semantics; mausCode adds device auth + `~/.mauscode/
ssh-launch/` managed servers + loopback forward (T3 launcher pattern, C3).
`docker`/`daytona`: launcher creates/starts container/workspace with node image,
then behaves like `remote`. `remote`: device-registry resolution + relay or direct
WSS + bearer. All placements present the identical `RuntimeHandle`.

## 5. Device model (remote node lifecycle)

`register → challenge/auth → connect → heartbeat → capability discovery →
workspace allocation → event streaming → disconnect/reconnect → revoke/upgrade`.
Device record: id, name, platform/arch, node version, capabilities, last-seen, status,
auth method. Registry + relay live server-side (separate track); the app track owns
the device *protocol* and the node-side agent (`mauscode node start`).
Security posture: bearers rotatable + revocable; relay never sees plaintext credentials
(E2E for credential refs where feasible, TLS minimum); unknown-host-key refusal;
non-interactive SSH; clock-skew tolerant proofs; per-device version floor with
negotiated upgrade. No insecure arbitrary remote exec: every remote op is a typed
protocol request under workspace policy.

## 6. BYOK model

Provider catalog (reuse JCode metadata) + credential refs (`safeStorage` locally,
per-device stores remotely, never synced without explicit user action). Resolution
order: workspace route → device default → env (explicit opt-in). `set_api_key` only
ever called with user-supplied material over a local/trusted channel; remote
forwarding uses short-lived tokens. Rotation/revocation are protocol events that
invalidate caches immediately. Local-only mode: full product, zero account.

## 7. Performance gates

- Benchmarks live in `benchmarks/`; results + method in `.dump/app/benchmarks/`.
  Matrix: cold/warm start, first response/token, first tool call, session create/
  resume, terminal spawn, fs ops, event throughput, RSS idle + per-session at
  1/5/10/25/50 sessions, SSH attach, device reconnect, file index.
- JCode claims to reproduce first (27.8 MB PSS single-session baseline shape;
  per-client delta; OpenCode/Claude/Codex comparators where runnable).
- CI owns numbers (sandbox lacks bun); no "faster" claims without a run link.
- UI budgets: streaming chunk → paint <1 frame at 60fps for text; lists virtualized
  past 100 rows; no full-transcript re-serialization on append (fix JSON-blob writes
  as part of daemon-source-of-truth migration).

## 8. Phased implementation (vertical slices, exit criteria)

- P0. Foundations (no behavior change): OpenSpec proposal for protocol; `docs/
  protocol.md` v0; runtime-client package skeleton (connect/ping/list_sessions
  against stock JCode); `mauscode doctor` stub; benchmark harness; kill dead code
  (`credential-manager.ts`) after confirming zero refs, done, the file is deleted;
  secret-refactor `customConfig.token` → credential ref.
  CORRECTED 2026-09-14 by roadmap step 01: this line used to name `mock-api` as dead
  code to kill. The reference check returns four importers, not zero, so `mock-api`
  is KEEP. Measured list and reasoning in
  `.dump/app/decisions/2026-09-14-mock-api-disposition.md`.
- P1. Native local execution: daemon spawn + lifecycle in Electron main; `chat` path
  for one provider routed through harness `send_message`; ApiEvent→UIMessageChunk
  translation; cancel/permission/rewind/compact mapped; sessionId = JCode id;
  existing UI (tabs/queue/diff) untouched. Exit: same UI/workspace/session works on
  JCode locally for the P0 benchmark matrix.
- P2. Files/Git/terminal parity: runtime file ops for session cwd; git engine stays,
  gains remote-readiness (path scoping per workspace); terminal manager kept, session
  records gain placement field. Exit: file search/read/watch + worktree flows pass
  against native runtime.
- P3. BYOK completion: catalog UI, account switching, per-workspace routes, Ollama as
  OpenAI-compatible entry, rotation/revocation. Exit: all providers via refs; zero
  tokens in args/logs (audit).
- P4. Product workflows preserved: plan/approve, queue (still renderer), rollback/
  checkpoint pairing, PR flows, automations-local subset. Exit: 1Code feature
  checklist green on native runtime.
- P5. Remote node + SSH: `mauscode node`, SSH placement + launcher + minimal picker,
  device protocol P0 (register/auth/heartbeat/caps/revoke). Exit: workspace moves
  local→SSH with zero state-model change (the architectural proof).
- P6. Docker + Daytona placements. Exit: same proof for containers.
- P7. Device registry/relay + full devices UI. Exit: spare-box onboarding <5 min.
- P8. Compatibility adapters (Codex ACP first as reference, then Claude/OpenCode/
  Hermes) + migration engine MVP (Claude + OpenCode). Exit: import flow per
  migration-system.md assumptions A1–A7.
- P9. Harden + optimize: permission policy audit + tests per allow-rule, threat model
  doc, telemetry policy implementation, UI refinement pass, release engineering.

Explicitly deferred: swarm/ambient/overnight defaults (keep compiling, off),
Gmail/computer-use tools (curate tool allowlist per workspace instead), HTTP API
surface (only at relay boundary), OpenChamber research (no source).

## 9. Risks

- R1. Parallel-agent collisions on `docs/` + `src/` — mitigate: OpenSpec proposals
  as coordination points; human arbitrates ownership.
- R2. JCode upstream velocity (v0.84, daily star-chart commits) — mitigate: pin SHA
  in UPSTREAM.md; rebase vendor quarterly, not continuously.
- R3. Harness v1 gaps (no PTY, no git) — mitigate: extensions (§3), never internal-
  protocol coupling.
- R4. Electron-main bloat (runtime client + daemon management in JS) — mitigate: keep
  translation thin; heavy lifting (pooling, supervision) stays in Rust; measure.
- R5. Inherited permission bypass — mitigate: fresh policy, deny-by-default, tests;
  never port `bypassPermissions` semantics.
