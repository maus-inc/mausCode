# Second Brain - App

Compact architectural memory of mausCode (app track). Update as understanding changes.
Detail lives in `research/` and `plans/`; this file states what is true.

## Architecture

- Electron app; UI (inherited 1Code, React 19) → application layer (tRPC, thinning) →
  runtime client (harness-api v1 NDJSON) → mausCode runtime (refined JCode daemon).
- One `RuntimeHandle` per workspace; placements (local/SSH/Docker/Daytona/remote node)
  differ only in launcher. Workspace model is placement-independent.
- Compatibility adapters (Claude/Codex/OpenCode/Hermes) implement the same handle
  interface; native path never depends on them.

## Runtime model

- JCode upstream v0.84.0 (MIT): single-server multi-client, sessions daemon-owned,
  stable harness-api v1 (`{v,id,req}`/`{v,reply_to?,ev}`), TS SDK with platform
  binaries, shared MCP pool, provider catalog, hooks, rewind/compaction/snapshots,
  native SSH attach, session import parsers (Claude/Codex/OpenCode/Cursor/Pi).
- mausCode extensions are minor-versioned `maus.*` kinds: workspace, device,
  checkpoint, taskgraph, doctor. No PTY-in-protocol yet; no git-in-protocol (kept
  in app/git engine).

## Major invariants

- I-1 UI speaks only to application layer. I-2 workspaces are placement-independent.
- I-3 JCode stays standalone-usable; no incompatible protocol fork without major bump.
- I-4 native never depends on adapters. I-5 secrets are refs at every boundary.
- I-6 benchmarks gate every phase.

## Proven (2026-09-11, sandbox)

- `packages/runtime-client/` (fork of SDK 1.2.0-dev, MIT preserved): typecheck +
  43/43 tests green; live proof vs stock binary 1.1.0 — launch 52–57ms,
  createSession 5–12ms, ping/list/attach green; daemon+bridge ≈57MB RSS (1 idle
  session). Details + caveats: `benchmarks/2026-09-11-stock-jcode-sandbox.md`.
- `docs/protocol.md` v0 is the normative contract; change control via OpenSpec
  `runtime-protocol` capability. Remaining P0: 1Code-baseline app numbers (CI-owned).
- `runtime/jcode/` vendors stock JCode at ce4e789 (MIT preserved, .git/assets excluded
  per its UPSTREAM.md; tree verified byte-identical). Parity tests resolve to it with
  zero env config (43/43). First change on the vendor: none yet — stock.
- P1 change `add-native-local-execution` implemented on branch
  `arena/01a08de4-mauscode` (human-approved 2026-09-11): additive Electron-main
  runtime host (`main/lib/runtime/`: manager/translate/sessions/credentials) +
  `runtime` tRPC router (chat/cancel/respondApproval/rewind/compact/status) +
  `NativeChatTransport` + per-sub-chat engine flag (Legacy default, Native opt-in
  on empty local claude-code chats). 13/13 unit tests green
  (`node --test --experimental-strip-types`); tsc adds zero new errors vs
  baseline (repo baseline is dirty; `ts:check`/tsgo unavailable in sandbox).
  Known P1 limits as shipped: plan mode refused on native (no read-only
  enforcement yet); offline/Ollama refused with clear errors; stock bridge has
  no `permissions` capability so approval synthesis is dormant until the mausCode
  runtime patch; Codex stays on ACP; remote chats stay remote. (Custom
  endpoints + project MCP + session-init were P1 limits too — retired by the
  follow-ups below.)
- P1 verification track (2026-09-11, `e482f5e` accepted): no dev machine in
  session — static verification only (13/13 unit tests; tsc zero-new-errors;
  main bundle emits with P1 code; renderer bundle blocked pre-existing on
  shiki/ayu-light under the npm tree; guards + legacy non-interference
  audited by inspection). Record:
  `benchmarks/2026-09-11-p1-verification.md`. Gate stays CLOSED; live smoke,
  benchmarks, crash-kill, and `openspec validate` are CI/dev-owned.
- Follow-ups, all approved scope=all 2026-09-11, all committed on
  `arena/01a08de4-mauscode` on top of `6be8f71` (scaffold):
  `915bd01` → `d52a188` → `8072e05` → `1c50995` → `db77404`:
  - `add-runtime-permissions` (`915bd01`, spec only): stdin-mirror 9-step Rust
    patch spec, Option B capability shape, client no-change; CI/dev-owned
    (no Rust toolchain in sandbox).
  - `add-native-endpoint-config` (`d52a188`, implemented): daemon-level endpoint
    settings (singleton + migration), honored-endpoint credential matching,
    launch-env + restart, settings UI; live stub-E2E turn proves honoring.
  - `add-native-mcp-passthrough` (`8072e05`, Phase 1 implemented): app-side
    config mirror + schema-cache evidence; Phase 2 Rust relay specified.
  - `add-native-session-init` (`1c50995`, implemented): honest native snapshot
    (`toolsUnknown`, config-error notices), engine-toggle clearing.
  - `add-codex-native-support` (CLOSED as WONTFIX 2026-09-11): Codex stays on
    the CLI adapter (OAuth unprovisionable via harness; key-only would fork
    toggle rules); toggle's codex-disabled copy fixed; adapter upgrades move
    under `add-fork-harvest-transplants`. Revisit on a harness OAuth arm.
- Fork-harvest intake (2026-09-11): pulled the harvest ledger
  (`.dump/ci/research/`, commits `fb47761`+`140eb25`) onto the arena branch;
  spot-verified (9/9 repos resolve, SamSammanne confirmed gone, 1Code
  Apache-2.0 archived, T3 MIT, key transplant paths exist). Scaffolded
  `add-fork-harvest-transplants` (phased: aadivar widget → erenbertr backend
  → transports/UI → T3 contracts → codex-app-server eval); NO code
  transplanted yet — per-phase go-ahead pending. Codex mapping: harvest
  items strengthen the Codex adapter, don't provision native OAuth, so the
  native decision is substantively unchanged (still deferred, re-asked).
  Pending user gates: sidebar lineage (erenbertr vs sylv), Effect adoption,
  per-phase go-aheads. Not adopted from the harvest: foreign co-author
  trailers, PAT push, `init`-branch workflow (arena only here).
  Full runtime suite at head: 27/27 green; tsc error set identical to
  baseline (99 = 99, none in new files).

## Important interfaces

- `RuntimeProvider.launch/status/stop` → `RuntimeHandle { request, events }`.
- `ApiEvent→UIMessageChunk` translation (`main/lib/runtime/translate.ts`).
  Cross-process wire constants (`native:` question prefix, `NATIVE_` error
  prefix) live in `src/shared/runtime-protocol.ts`.
- tRPC 20 routers shrink to adapters; `chats` keeps product workflows; `changes`
  (git) kept whole; terminal manager kept for local.

## Performance principles

- Hot path: UI → transport → JCode → OS. No JS orchestration layers on it.
- Daemon owns sessions/transcripts; DB keeps metadata/index (JSON-blob writes go away).
- Reproduce JCode's published numbers before claiming anything; CI owns measurement
  (sandbox has node, no bun). UI: per-message atom isolation (already good), virtualize
  >100 rows, throttle bg progress events.

## Compatibility model

- Adapter = translate maus protocol ↔ foreign CLI protocol (Codex ACP first as the
  reference, since the code already speaks ACP). Foreign tools never shape native types.

## Remote runtime model

- `mauscode node` daemon; lifecycle register/auth/connect/heartbeat/caps/allocate/
  stream/disconnect/reconnect/revoke/upgrade. SSH first (JCode attach semantics +
  maus device auth + T3-style launcher/forwarding). Relay is control-plane track.

## BYOK model

- Catalog + credential refs; safeStorage local, per-device remote, no silent sync;
  workspace route → device default → env(opt-in). Local-only full product, no account.

## Migration model

- Detect→Preview→Map→Confirm→Import, manifest + rollback, originals untouched.
- Transcripts untrusted (provenance banner, no auto-exec); creds referenced not copied;
  foreign hooks import disabled. MVP: Claude + OpenCode.

## Rejected approaches

- JCode-as-adapter; 1Code+JCode merge; bypass-permissions default; Hermes-style silent
  teardown sync (opt-in only); HTTP-everywhere locally (NDJSON local, HTTP only remote);
- Big-bang rewrite of chats/terminal/git UI before vertical slice; depending on
  21st.dev for anything.

## Proposed, not approved (2026-09-12)

- A Jules-feature port program is drafted in `plans/2026-09-12-jules-port-plan.md` (waves W0–W14) with the
  per-feature verdicts recorded in `decisions/2026-09-12-jules-feature-triage.md`. **No code, no OpenSpec
  change, and no task in an existing scaffold has been changed by it.** Two facts it relies on are worth
  carrying here: `src/shared/contracts/` (24,860 lines of ported T3 schemas + 23 test files) has **zero
  importers** outside its own directory, and `main/lib/runtime/translate.ts:147-168` discards 22 harness events
  including `session_status`, `background_progress` and `wake_requested`. The vendored PR/CI vocabulary in
  `contracts/orchestration.ts:630-699` (`ThreadPullRequestLink`/`Snapshot`) is the one part worth wiring up first.

- Recreation of the 1Code v0.0.75→v0.0.84 parity program lives in `plans/release-parity-v0.0.75-0.0.84-plan.md`
  (phases P0-P8, 47 items). It was lost with the session that wrote it, so it is rebuilt here with every item
  re-measured against `1a37e0b`: P0-1/P0-2 are already fixed on this branch, the Biome gate is 0 errors / 135
  warnings, and two of its original claims (dead `updatePrInfo`, "three pollers") are corrected in place.
- Two research spikes (2026-09-13, read-only) sit in `research/`:
  `2026-09-13-t3code-pr-state-spike.md` (how PR state is discovered, cached and de-duplicated upstream; 60 s
  success / 20 s→15 min failure TTL split; a 55-line Effect-free `dedupeChecks` worth vendoring) and
  `2026-09-13-hermes-memory-spike.md` (memory as a provider *lifecycle*: static prompt block vs per-turn recall,
  `queue_prefetch` consumed next turn, fail-closed pre-compress checkpoint, unattended writes limited to `add`).

## Unresolved user-facing decisions

- Wordmark selection (5 PNGs in `new mauscode branding/`); CLI/app-id naming
  (provisional: `mauscode`, `dev.maus-inc.mauscode`); JCode vendor form + attribution
  placement (provisional: copied tree under `runtime/jcode` + UPSTREAM.md + MIT notice);
  telemetry policy contents; release channel/CDN owner. See `decisions/`.
- P1 user-facing provisionals needing confirmation: engine toggle labels
  ("Legacy"/"Native"); refusal copy for plan mode / offline / custom endpoints
  on native; whether native stays opt-in per-chat pending the benchmark gate.
  See `decisions/provisional-assumptions.md` (PA-7+).
