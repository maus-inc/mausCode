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
- Run state is a database record (roadmap step 07). `runs` + `run_events`
  tables, machine in `src/main/lib/runs/run-state.ts`, statuses
  `running | waiting_approval | completed | error | cancelled | interrupted`,
  feed over `runs.subscribe`, renderer projects it into the streaming status
  store. Startup moves active runs to `interrupted` with the last event as
  evidence. Wired for `claude.chat` and `runtime.chat`; other provider routers
  are declared absent until wired. Contract: `.dump/app/plans/2026-09-13-run-state.md`.
- Queued messages are database rows in main (roadmap step 08). `queue_items`,
  statuses `pending | paused | sending`, store in `src/main/lib/queue/`, wire
  surface `queue.*` with `claim` as the only hand-off: one transaction and a
  conditional update mean one window receives a row. Order is gapped integer
  positions, rewritten only when a gap runs out. A claimed row is deleted on
  `complete`, returned by `requeue`, and returned by startup recovery when a
  window died holding it. The renderer projects the feed and performs the send.
  A manual stop pauses the queue. Contract: `.dump/app/plans/2026-09-17-queue-in-main.md`.

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

## User-facing decisions (2026-09-14)

- All eighteen numbered items in `.dump/global/questions.md` are answered, in four batches across
  2026-09-13 and 2026-09-14, each recorded in `.dump/global/decisions.md` with the rejected option
  named. Closed here: app id `dev.mausinc.mauscode` with display name `mausCode` and npm name and CLI
  `mauscode`, PA-1 corrected to call `com.maus-inc.mauscode` stale, `package.json` `name` `mauscode` and
  `version` `0.1.0` as the step 31 targets, channels alpha and stable on GitHub Releases with no CDN, and
  no signing or notarization anywhere, so artifacts are unsigned by design with SHA256SUMS as the
  integrity story. 1Code data stays read-only detection permanently, with no import button and no
  migration. JCode vendor form is ratified: copied tree under `runtime/jcode` with `UPSTREAM.md` and the
  MIT notice.
- Still a taste call, and nothing else is: which wordmark is the product's, among the five PNGs in the
  branding masters directory that roadmap step 31 relocates to `assets/branding/`. It blocks no step;
  step 25 and any marketing pass need an answer.
- P1 user-facing provisionals needing confirmation: engine toggle labels
  ("Legacy"/"Native"); refusal copy for plan mode / offline / custom endpoints
  on native; whether native stays opt-in per-chat pending the benchmark gate.
  See `decisions/provisional-assumptions.md` (PA-7+). Each is a small localized change to overturn.
- P1 user-facing provisionals needing confirmation: engine toggle labels
  ("Legacy"/"Native"); refusal copy for plan mode / offline / custom endpoints
  on native; whether native stays opt-in per-chat pending the benchmark gate.
  See `decisions/provisional-assumptions.md` (PA-7+).

## Build gate (2026-09-14)

Roadmap step 03, issue #5, executed on `arena/01a09fc7-mauscode` (base
`arena/01a097c4-mauscode`). The sandbox (Debian 12, 2 cores, 3.8 GB RAM, no
display stack, proxy-restricted network) runs the frozen-lockfile install,
both fast bundles and all nine gate commands, all green at the numbers in
`benchmarks/2026-09-13-build-gate.md`. It cannot run the renderer build under
either the 1.91 GB default heap or the 4 GB CI flag, and it cannot run the
binary downloads, packaging or the launch test; each is recorded there with
the exact failure. The CI jobs on the step 03 PR are the reference run for
the renderer build, the downloads and the packaging; no CI job launches
the packaged app, so the launch check stays open. One fact in
`.dump/ci/second-brain.md` is stale as of this run: GitHub release assets
now resolve to `release-assets.githubusercontent.com`, which is blocked like
the `objects.githubusercontent.com` host it replaced; correcting that file
is the CI domain to do.

## Skills (2026-09-13)

`AGENTS.md` makes `find-skills` mandatory before a step is designed. Six skills are in `.agents/skills/`,
`unslop`, `find-skills`, and four installed today with hashes in `skills-lock.json`, `skill-creator` and
`frontend-design` from `anthropics/skills`, `vercel-react-best-practices` and `vercel-composition-patterns`
from `vercel-labs/agent-skills`, about 547 KB of documentation that the app never imports. Two candidates
were refused with reasons on record, `web-design-guidelines` because it fetches its rules from a URL at
review time and `webapp-testing` because it tells the agent to run Playwright scripts as black boxes. The
registry's keyword search endpoint returns nothing for every query from this environment, so discovery
goes through the leaderboard and the repository listing, and a "no skills found" result is a tool failure
rather than an empty ecosystem.

## Roadmap and issues (2026-09-13)

`plans/2026-09-13-mauscode-roadmap.md` is the single ordered sequence, 45 steps, issued to
GitHub with the `roadmap` label and generated from `.dump/app/roadmap/NN-<slug>.md`.
Steps 36 to 42 and 45 are the fork-harvest program, and steps 43 and 44 are the self-improvement
loop, the skill lifecycle and session recall ported from hermes-agent's learning loop, wording in
`research/2026-09-13-self-improvement-loop.md`, with the discovery record for what the skill
ecosystem does and does not offer for these steps in
`research/2026-09-13-find-skills-run.md`.
Steps 36 to 42 were the first pass at the fork-harvest program, the ledger in `.dump/ci/research/fork-network-harvest-catalog.md`
and its handoff turned into work items, so an adopted or refused piece stays refused. Issue bodies
follow `.github/ISSUE_TEMPLATE/roadmap-step.md`, which requires measured evidence with an
evidence level, a plan in commit order, Always and Ask-first and Never boundaries, verifiable
acceptance criteria, the exact gate commands, and stated out-of-scope. The issue bodies carry
step numbers, not prose references, so the order survives a resequence.

Read before implementing anything in the sequence: §5 of the roadmap lists nine corpus claims
that did not survive re-measurement at `d5bdf69`, including the changelog anchor, which is
already fixed, and the Codex app-server port, which already shipped. Steps 01 to 04 are the
prerequisites; steps 10 and 11 are the two critical-risk gates everything unattended depends on.

State on 2026-09-14, after the decision batches. The `roadmap` label is on all 46 issues, #3 to #48,
applied by the human in the web UI, so step 22's issue trigger is live; the write probe issue is
deleted. Twelve issue bodies are behind their files and the human accepted that as the steady state,
so `.dump/app/roadmap/NN-<slug>.md` is the source of truth and `{{SNN}}` resolves to `#NN+2`; see plan
§4b. Plan §4c records that this session ends at planning, with no step executed and nothing further
landing on `arena/01a097c4-mauscode`. The vendored contracts tree has an adoption ledger at
`plans/contracts-adoption.md`, measured at 44 source files and 19,395 lines plus 23 ported test files
and 5,465 lines, 24,860 total, which confirms the figure the corpus already carried; the ledger's first
pass was 67 lines high and its own correction note records that.

## Instruction truth (2026-09-14)

Roadmap step 01, issue #3, executed on `arena/01a09f45-mauscode` at `7c89af0`. `CLAUDE.md`
and `openspec/project.md` now describe the tree; every path in both resolves. What was false:
the router count (36 mounted from 37 files, not 20), the agent mode count (five, `plan`, `ask`,
`edit`, `agent`, `turbo`, declared in `src/renderer/features/agents/atoms/index.ts`, not two),
the SDK name (`@anthropic-ai/claude-agent-sdk` 0.2.45, not `@anthropic-ai/claude-code`), a
renderer `features/sub-chats/` folder that does not exist, a file naming convention stated
backwards, a Debug Mode section pointing at an absent `packages/debug/`, a notarization
procedure for a program that refuses signing, and a "three main tables" database when the
schema declares 11.

Two step-file claims did not survive measurement and are corrected in
`.dump/app/roadmap/01-instruction-truth.md`. Only one system map exists, at
`research/current-system-map.md`, so no duplicate had to be deleted; and `ts:check` was already
assigned to step 02 by answers item 11, so step 01 left the script alone and documented the
handoff. `mock-api.ts` is KEEP with four importers, decided in
`decisions/2026-09-14-mock-api-disposition.md`, which closes the contradiction roadmap section 5
carried. The full record is `decisions/2026-09-13-instruction-truth.md`.

One finding is recorded and unowned: the five agent mode names are written out in 38 places
beside the declaration, 14 zod enums and 24 TypeScript unions. No roadmap step covers it.
