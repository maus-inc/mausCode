# Tasks: add-fork-harvest-transplants

## Intake (done 2026-09-11)

- [x] Pull + read harvest docs (`.dump/ci/research/`) in full
- [x] Spot-verify: 9/9 named repos resolve; SamSammanne confirmed Not Found;
      1Code Apache-2.0 + archived; T3 MIT; aadivar widget files + erenbertr
      normalizer paths exist at their HEADs
- [x] Scaffold this change (no code transplanted)
- [ ] Run `openspec validate add-fork-harvest-transplants --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Approvals (gate for all phases)

- [ ] Human approves this proposal + Phase 1 scope (aadivar widget)
- [ ] Sidebar lineage decision recorded (erenbertr vs sylv — one line)
- [x] Effect-adoption decision recorded (before Phase 4)
- [ ] Per-phase go-ahead before each subsequent phase

## Phase 1 — aadivar usage widget

- [x] Re-map the 4 files onto arena HEAD; transplant hunk-level
- [x] Router registration + widget wiring review (maus branding kept)
- [x] Verify: tsc 99=99 zero-new, 27/27 runtime tests, no-secret scan
- [x] Update catalog action log + checkboxes (keep the live ledger live)

## Phase 2 — erenbertr backend core

- [x] Normalizer + codex reasoning-effort/model parse + coalescer loop + codex 0.137 bump + ACP repair (codex-acp 0.15.0)
- [x] Claude token refresh rework + system-first auth + async getClaudeCodeToken + ambient-env precedence + SDK getOAuthToken hook
- [x] chats (OAuth commit-msgs, inProgress/isUnseen, markViewed/All, updateColor) + projects (listWithStatus, reorder, updateColor, setShowInRail) + schema 0009 (5 cols)
- [x] New providers: gemini + openrouter + github + usage routers, 8 lib files, @ai-sdk/google + @openrouter/ai-sdk-provider
- [x] Renderer-crash auto-recovery + dock guards; token-crypto/native/auth preserved; build/ai/ai-one-shot excluded
- [x] Verify: tsc 99→76 (zero main-process errors, zero-new), 43/43 runtime tests, secret scan clean, 0000–0009 replay OK
- [x] Catalog action log + checkboxes updated

## Phase 3 — erenbertr transports + UI + QoL (IN PROGRESS)

- [x] Batch A: renderer QoL + providers UI (82 files, +2483/-708): gemini/openrouter
      transports + model browser + creation/selector/settings/transport wiring,
      question/awaiting/commit-push sounds + read-state loop (markViewed),
      pushed-checkmark, reactive tab cap, error boundaries, rename sync,
      autofocus race fix, provider-inference catch-up; native/kanban/Zap kept
- [x] Batch A verify: tsc 76->33 (zero new; new-chat-form 16->0), 70/70
      runtime tests (4 jcode-vendored fails pre-existing, untouched), secret
      scan clean (1 benign placeholder), api-bridge 0 additions
- [x] Batch B: remainder hunk triage — all 63 diff files classified; takes:
      mention `source` +`plugin` (fixes 2 tsc), mem-trace main/preload/d.ts
      completion; verified deliberate keeps (native/kanban/login-modal/
      usage-widget/rail-build-api-bridge-Cmd+T-logs-casts)
- [x] Batch B verify: tsc 33->31 (exact delta = 2 fixed, zero new), 70/70
      runtime tests, secret scan clean, api-bridge 0 additions
- [x] Batch C (SIDEBAR — lineage DECIDED 2026-09-11: adopt erenbertr):
      projects-rail + all-projects-page (new), agents-sidebar rewrite,
      subchats-sidebar absorption, content/layout/App rail wiring, Cmd+T
      rebind, footer wiring + usage-widget retirement
- [x] Batch C verify: tsc 31->25 (delta = 6 fixed, zero new), node--test 27/27, secrets clean

## Phase 4 — T3 contracts (APPROVED 2026-09-11: user T3 FULL-ADOPT)

- [x] Effect-adoption decision recorded (.dump/app/decisions/effect-adoption-t3-layers-2026-09-11.md): effect isolated to T3 layers, exact pin 4.0.0-rc.112
- [x] Ported 67 files to src/shared/contracts/ @211618f (verbatim + attribution headers; vite-plus/test->vitest); T3 ids kept, renames deferred
- [x] Deps: effect 4.0.0-rc.112 (exact), vitest + @effect/vitest (dev); npm run test:contracts
- [x] Verify: vitest 382/382, tsc zero-delta (25), node--test 27/27, secrets clean

## Phase 5 — T3 codex-app-server evaluation (SPIKED 2026-09-11)

- [x] Spike: 18 files run in our toolchain (vitest 36/36 incl. live stdio
      mock-peer round-trip); report in .dump/app/research/phase5-codex-app-server-spike.md
- [x] Verdict: ADOPT as follow-up port (native app-server replaces ACP hop;
      adapter only, WONTFIX unchanged); RC pins kept in devDeps; scratch removed

## Phase 6 — SamSammane/1code-ui (reviewed; micro-ports done)

- [x] Re-check access: HEAD `12f0676` resolves; fetched to `refs/harvest/1code-ui`
- [x] Review 3 commits (Cursor CLI integration, web API server, parity fixes;
      dist-web excluded)
- [x] Scoped port: cli-binaries + codex/claude PATH fallback,
      CODEX_SUBSCRIPTION_ONLY_MODEL_IDS + filters, hidden-models v5
- [x] Verify: tsc identical-31 (zero new), 70/70 tests, secrets clean
- [x] Cursor-provider adoption: APPROVED 2026-09-11
- [x] Phase 6b: Cursor provider port (binary, router, transport, login UI,
      selector/form/input wiring, MCP tab) per
      .dump/app/decisions/phase6-cursor-provider-adoption.md
- [x] Phase 6b verify: tsc zero-delta (25), node--test 27/27, secrets clean
- [x] Rejected: web-standalone + vendor-auth-optional (out of scope /
      opposite direction)

## Phase 7 — sylvain mine (reviewed 2026-09-11)

- [x] Take: dev-server feature (detect router + hook + button + constants,
      running-atom, active-chat render; FR->EN)
- [x] Verify: tsc zero-delta (25), node--test 27/27, secrets clean
- [x] Rejected: archive/reorder (already-have), emoji picker (dep+pipeline
      weight), 5-mode taxonomy HELD (user-facing scope decision)

## Phase 8 — jhckevin (reviewed 2026-09-11, rejected wholesale)

- [x] Rejected: backend-route (no consumer), banner-model/changelog-url
      (already inline), release-config (overlaps ours, branded, no consumer)

## Phase 9 — ning (reviewed 2026-09-11, rejected wholesale)

- [x] Rejected: security-mining (zh-only pentest niche); tooling/ subsystem
      (arch fork: private claude home, ProviderAdapter, router rewrites);
      skills exts (need that backend); skill-md + voice already-have

## Phase 10 — Locus (scoped 2026-09-11, no blind ports)

- [x] Queued: (1) chat-session-binding re-implemented our way (own OpenSpec),
      (2) provider-diagnostics taxonomy, (3) local-only guard (product call)
- [x] Rejected/queued rest: capability model, workbench, jobs, headless, i18n,
      registry, mcp-import-preview (no consumer), git/file-stats (their-UI)

## Phase 11 — T3 server (reviewed 2026-09-11, HELD)

- [x] Held: Effect-based serve/pairing/DPoP/MCP-HTTP/exposure — replatform
      scale, no shared substrate; needs explicit user/product approval

## Pending (not in any phase until reviewed)

- [ ] (none — all known forks triaged;mausCode)
