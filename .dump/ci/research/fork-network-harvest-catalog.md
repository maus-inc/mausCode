# Fork-Network Harvest Catalog

Survey of the entire public fork network of `21st-dev/1code` (618 forks) as of 2026-09-11, to find what is actually ahead of the frozen upstream(fork tip `9f1bc76` = v0.0.72)and which of it is worth cherry-picking into mausCode.

## Method of the survey
1. Enumerated all 618 forks (GitHub forks API, all pages)
2. Flagged any fork whose default-branch tip SHA != upstream frozen tip
3. Fetched each flagged fork locally and measured commits since upstream (`git rev-list --count 9f1bc76..<ref>`)
4. Stale forks (tip points at an *old upstream tag* like v0.0.52/0.0.53) excluded - they froze earlier, not ahead
5. Each real candidate: extracted per-fork diff/commit list, tagged what it adds vs our baseline(and our current `init` tree, which already includes maus branding/rebase work).

## Real candidates(delta vs upstream tip)


| Fork | Commits | Changed files | Nature | Verdict |
|---|---|---|---|---|
| lupanpan1030/agent-code-for-me (`Locus`) | 1,174 | 2,103 (+367k/-48k) | Mature parallel product: local-first workbench + runtime boundary for Claude Code/Codex; sessions, capability truth, audit, handoff; OpenSpec workflow identical to ours; i18n bilingual-UI branch | DEEP MINE - highest value; cherry-pick domains, not wholesale |
| erenbertr/1code |  1 89 |  1 230 (+20.6k/-8.5k) | Big feature fork: Codex CLI 0..->0..137, Gemini/OpenRouter ACP, mind-map AI builder, streaming/memory fixes, usage-stats, sub-chat sidebar rework | CHERRY-PICK base - user approved: everything except kanban + mind-map + feature removals |
| aadivar/1code |  1 77 (sync commits) | 22 (+1.7k) | Sync/continuity fork: replays upstream into git, tags releases, adds Claude Code usage-stats widget | WIDGET ONLY (claude-usage router + usage-widget.tsx, widget-settings-popup tweak) |
| ningzhaoxing/1code |30 |302 (+31.5k/-8.9k) | Skills + security-mining fork: Claude skills install/core, tooling management, vulnerability-research workbench, security-mining record workflow, UI polish (Chinese-annotated) | CAREFUL REVIEW - skills/security-mining concepts win; check for copypasta/hardcoded paths(Chinese UI strings possibly)cherrypick with care" |
| jhckevin/1code |4 |161 (+7.3k/-9.6k) | OpenCodex replatform: app-server launch profiles, backend-route model, auth-manager DELETED(-301), sandbox-import DELETED(-426), release-config scripts, brand -> opencodex | SKIP wholesale - net-negative + architecture fork; mine: `opencodex-backend-route.ts` model, release-config.mjs, banner-model, changelog-url(upstream-independent pieces; do NOT take its auth deletions |
| sylvaindiv/1code |1 |65 (+4.8k/-0.9k) | One-shot big feat: agents sidebar redesign (dnd reorder, sub-chat archive, per-project emoji picker, new modes), DB migrations, dev-server router | ONE-FEATURE mine - sidebar reorder + sub-chat archive + emoji picker(check against our own sidebar plan; BIG overlap with erenbertr's sub-chat work - pick one lineage) |
| ken-jo/1code |1 |4 (+57/-354) | `remove auth` - removes built-in login flow (src/main/index.ts -234, windows/main.ts rework, App.tsx) | REJECT for us - we want auth; but study its pattern if we ever want a "passwordless" mode |
| PsyberKadi/1code |1 |1 (+21) | Adds `GITHUB_AUTOMATION_SNAPSHOT_2026-06-30.md` (freeze-recovery doc) | MAYBE - doc only; free for the taking if we want the snapshot |
| SamSammanne/1code-ui | 3 on v0.0.72 (`12f0676`) | Cursor CLI integration (cursor router 941 lines, cursor-agent-binary, cursor-mcp, transport, login flow), web API server (src/web-server), desktop/web parity, standalone preview/config, Cursor model resolution (src/shared/cursor-model-id.ts) | ACCESSIBLE since 2026-09-11 re-check - fetched to refs/harvest/1code-ui; Phase 6 track opened (dist-web build output excluded) |
| aletc1/1code |0 |- |tip==upstream ancestor; not actually ahead | SKIP |

## Cherry-pick ledger (live, will edit as we pick)

## Category A - Approved by user (from erenbertr/1code)
- [x] Codex upgrades: bundled CLI 0..->0..137.0, codex-acp adapter repair, tool-normalizer `src/shared/codex-tool-normalizer.ts` - BACKEND TRANSPLANTED 2026-09-11 (Phase 2)
- [x] Gemini ACP provider integration (message history + images, auto-alias/model fallback) - BACKEND TRANSPLANTED 2026-09-11 (Phase 2; router+libs+auth store; renderer UI in Phase 3)
- [x] OpenRouter provider + model selection (new-chat form, agent selector, workspace instructions in system prompt) - BACKEND TRANSPLANTED 2026-09-11 (Phase 2; router+libs+auth store; renderer UI in Phase 3)
- [x] Streaming stability fixes (abort listener removal, renderer crash-under-heap fixes, tab eviction) - PARTIAL 2026-09-11 (Phase 2: render-process-gone auto-recovery + dock guards; renderer-side pieces in Phase 3)

- [x] Usage-stats footer (quota %, 80% orange, reset-time label) - BACKEND TRANSPLANTED 2026-09-11 (Phase 2: usage+github routers, claude/gemini/openrouter usage libs; footer UI in Phase 3)
- [ ] Sidebar QoL (restore previously opened chat, file refresh button, drag/manual reorder via sort_order)
- [ ] Details-sidebar / misc polish (as diff-reviewed)
EXCLUDED by user: kanban (5 files)mind-map AI builder (React-Flow build surface, any "AI-bro feature removal" (their deletions: kanban, claude-login-modal.tsx, agents-subchats-sidebar.tsx - we keep ours)



### Category B - Domains worth mining (from Locus (lupanpan130
- [ ] Runtime boundary model(execution/session/capability/audit/handoff - mirrors our runtime-permissions scaffolds; CONCEPT + file-level transplant candidates:
- [ ] Codex/Claude provider capability truth + profiles (provider-profiles-gateway branch; tRPC capability rebaseline commits)
- [ ] Headless app server + jobs phase-0-4 (our future backend/CLI ambitions)
- [ ] Security: RCE regression tests, worktree trust tests (mirrors our runtime-permissions guard wiring)
- [ ] bilingual-UI (i18n surface,orthogonal low-risk)
- [ ] Audit/trace/ops discipline (acceptance-record + archive workflow - reinforces `.dump` standard; method: copy, not code)

### Category C - Small mines (with care flags)
- [ ] `ningzhaoxing`: skills install core + tooling-management + security-mining PoC (review for license/paths/zh-only UI; keep concepts/impl carefully)
- [ ] `sylvaindiv`: sidebar dnd reorder + sub-chat archive + emoji picker (overlaps erenbertr sub-chat work - pick ONE lineage; DB migrations included)
- [ ] `jhckevin`: standalone `opencodex-backend-route.ts` + `release-config.mjs` + `banner-model`/`changelog-url` (NOT its auth-manager/sandbox-import deletions)
- [x] `aadivar`: Claude Code usage-stats widget (approveed earlier) - TRANSPLANTED 2026-09-11 (Phase 1): router adapted to app token store (no keychain exec); fixed the fork's missing render case
- [ ] `PsyberKadi`: freeze-recovery automation snapshot doc (optional)

### Category D - Reject (documented why)
- [ ] `ken-jo`: auth removal (we want auth,maus sign-in) 
- [ ] `jhckevin` auth-manager + sandbox-import deletions
- [ ] `aletc1`: not actually ahead
- [ ] stale forks (tip==old upstream tags: rakshanNagesh19205, schulzfel, arafat877, varun-coditas, linrf et al.)

## Care flags(global)
1. **Two sidebar lineages conflict** - `erenbertr` (sub-chats-sidebar rework) vs `sylvaindiv` (dnd reorder+archive. Choose ONE; do not merge both blindly.
2. **Our `init` tree already diverged** (maus rebrand, CI ratchets, agent workspaces. Every pickup must be **re-applied on our tree**, not `git cherry-pick` blindly - expect conflicts with our branding/CI edits. Prefer file/hunk-level transplant reviewed by owie
3. **Database migrations must be re-sequenced** - drizzle migrations from forks (sylv, jhckevin, others) assume their history; ours diverged. Port schema changes manually; never copy migration files verbatim(conflicts with maus drizzle journal)
4. **License/source hygiene** - all these forks inherit 1Code's license;copying small file-level pieces is fine; no vendored binaries or secrets(some forks ship `.claude/settings.local.json` - skip those files entirely).
5.. **Priority: value per file, not per commit** - big forks rewritten whole files (Locus 367k insertions.We harvest **specific files/features**, never whole-tree merge.



## Category A - File map (erenbertr/1code, vs our current tree)

Delta base: `HEAD` (our init) <-> `forkup/main`. 230 files total: 66 A,, 123 M,, 40 D,,,, 1 R.

### Exclusion-safety(already enforced)
- `feat/build` (mind-map AI builder:9 files - EXCLUDED (user)
- `feat/kanban` (6 files: - DELETED in fork, so D-rows - we keep ours)



### Payload by subsystem(take/skip/conflict tags)
**`feat/agents` (~53 files: 46 M + 7 A core - THE payload)**
- Chat transports: `gemini-chat-transport.ts`, `openrouter-chat-transport.ts`, `acp-chat-transport.ts`, `ipc-chat-transport.ts`, `remote-chat-transport.ts` - TAKE (new provider support: gemini/openrouter/acp)
- Sub-chat: `stores/sub-chat-store.ts`, `ui/sub-chat-selector.tsx`, `ui/sub-chat-status-card.tsx`, `main/active-chat.tsx` - TAKE carefully(sidebar-lineage overlap with sylv - resolve ONE lineage before merging; our `agents-sidebar` untouched )
- Agent tools/UI: `ui/agent-tool-*`, `agent-diff-view`, `agent-edit-tool`, `agent-mcp-tool-call`, `agent-preview`, `agent-thinking-tool`, `pr-status-bar`, `mcp-servers-indicator` - TAKE (tool surface maps to our runtime/perms work)
- New-chat/model: `components/agent-model-selector.tsx`, `main/new-chat-form.tsx`, `lib/models.ts`, `work-mode-selector` - TAKE (OpenRouter/Gemini model select}
- `utils/auto-rename.ts`, `hooks/use-auto-import.ts`, `hooks/use-changed-files-tracking.ts` - TAKE (QoL}
- `atoms/index.ts` - MERGE carefully(global atoms shared; conflicts with ours expected)
**`src/main` (17 A + 19 M - backend core)**
- tRPC routers/mutations for agents/provider/sub-chats - TAKE (new router files A; M-routers merge

- codex binary bump (`0..->0..137`), ACP adapter repair, `src/shared/codex-tool-normalizer.ts` - TAKE (matches our codex-native scaffold}
- auth/streaming/auto-updater tweaks - REVIEW each file
**`drizzle` (12 A:- 0008-0013 + snapshots + journal)**
- Schema files for agents/sub-chats/automations - PORT MANUALLY(never copy migrations verbatim; re-sequence against our maus journal; see Care flag 3)
**`feat/sidebar` + `feat/projects` (3 A:- 2+1)**
- Sidebar/rail changes - TAKE carefully(lineage conflict flag 1)
**`openspec` (7 A:- their spec docs)**
- SKIP (their change archives; not our roadmap; keep ours); mine ideas only
**`feat/automations` (2 A:- inbox-view + constants)**
- REVIEW - not in exclusion list; new surface(automations inbox) - likely worth TAKE (small, orthogonal
**`feat/details-sidebar` (2 M), `feat/changes` (2 A/M), `feat/terminal` (4 M)**
- Small QoL - TAKE as reviewed
**`feat/onboarding`, `feat/layout`, `feat/mentions` (3 M), `src/preload` (2 M)**
- TAKE selectively(small wiring changes; review `preload` for security surface)
**`build` icons(4 A:- ico/icns/png), `electron.vite.config.ts`, `package.json`, `bun.lock(b]`, `tsconfig.json`, `README/CLAUDE` - SKIP/SELECT (branding stays ours; deps bump only if needed; don't take their README/CLAUDE wholesale)
**`scripts` (3 A+1 M)** - REVIEW (build/update scripts may carry their republish logic; take only generic parts (e.g. upload/manifest helper iff brand-neutral

### Category A - implementation notes
- Prefer **file/hunk transplant** over `git cherry-pick` (our tree diverged: branding, CI ratchets, drizzle journal}
- Each TAKE file: re-apply to our `init`-derived feature branch; click through for conflicts; keep maus branding"
- Order: backend core (src/main + shared normalizer} -> agent transports -> UI components -> drizzle port -> sidebar (final, after lineage decision)

## Category C - File maps(small mines)

- **`aadivar` (APPROVED)**: `src/main/lib/trpc/routers/claude-usage.ts`, `src/renderer/features/details-sidebar/sections/usage-widget.tsx`, `widget-settings-popup.tsx` tweak, `atoms/index.ts` (+9) - TAKE 4-files (usage quota widget as user-approved}
- **`ningzhaoxing` (care)**: skills install core + tooling-management + security-mining PoC (claude skills, workflows, vuln workbench UI) - REVIEW first: license/paths/zh-only strings; take concepts+clean impl
- **`sylvaindiv`**: sidebar dnd-reorder + sub-chat archive + emoji picker + dev-server router(1 commit; 65 files) - ONE line: either this or erenbertr's sub-chat line;; DB migrations port-manual
- **`jhckevin`**: standalone files only: `src/shared/opencodex-backend-route.ts` (+test), `scripts/release-config.mjs` (+test), `src/renderer/lib/updates/banner-model.ts`/`changelog-url.ts` (+tests), `tests/wor44-branding.test.mjs` - TAKE standalone; NOT its auth-manager/sandbox-import/CLI renames
- **`PsyberKadi`**: `GITHUB_AUTOMATION_SNAPSHOT_2026-06-30.md` - OPTIONAL doc
- **`ken-jo`**: REJECT (auth removal; we keep our login}

## t3code (pingdotgg/t3code) - deep-research base (new task}

- Status: 3,833 commits; active nightly (`v0.0.41-nightly.2026.0911` = today); many `agents/mcp-*` branches(mcp controls, conversations, environment, projects, queue-inputs, scheduled-tasks, terminals, preview-controls, checkpoints,. Target for: **optional backend for external CLIs** - port + refactor to our stack(do not build blind)Detailed lineage/architecture/port-plan requested `deep-research` - separate section below soon.

## Action log
- 2026-09-11: full fork-network scan(618 forks); candidates identified; catalog created.
- 2026-09-11(b): Category-A file map produced (above); Category-C maps added; SamSammanne Not Found; t3code fetched. Next: t3code deep-research + transplant per approval.
- 2026-09-11(c): app-track intake - pulled ledger onto arena; spot-verified (9/9 repos resolve, SamSammanne 404 re-confirmed, 1Code Apache-2.0/archived, T3 MIT, aadivar+normalizer paths exist); scaffolded `openspec/changes/add-fork-harvest-transplants/` (phased plan). No code transplanted yet - per-phase go-ahead pending.
- 2026-09-11(d): Phase 1 TRANSPLANTED (aadivar usage widget; see checkbox above).
- 2026-09-11(e): Phase 2 TRANSPLANTED (erenbertr backend core): normalizer+codex hunks, claude-token refresh, system-first auth, chats/projects routers + migration 0009, gemini/openrouter/github/usage routers + 8 lib files, renderer-crash recovery. Rejected: auth bypass, native-turn removals, token-crypto re-inline, build/ai feat. tsc 99->76 (zero main errors), 43/43 tests, secret scan clean.
- 2026-09-11(g): Phase 3 Batch A TRANSPLANTED (erenbertr renderer QoL + providers UI, 82 files): transports, model browser, sounds/read-state/pushed-marks, reactive tab cap, error boundaries, rename sync; kept native/kanban/Zap/mock-api; rejected extraction rewrites, Cmd+T rebind (sidebar-held), approval-inline, log-strip. tsc 76->33 zero-new, 70/70 tests, secrets clean.
- 2026-09-11(f): Phase 3 STARTED (erenbertr renderer; sidebar lineage still held); Phase 6 OPENED - SamSammane/1code-ui now accessible (HEAD 12f0676, fetched): Cursor CLI integration + web API server + parity fixes under review, dist-web output excluded.

## Notes on unrecoverable upstream
- `cdn.21st.dev` v0.0.85-0.0.88 source: never published to any fetched fork(binaries exist only. If wanted, ask 21st-dev to publish(optional, repo archived.



## Deep-research: T3 Code (pingdotgg/t3code) - port base for "optional backend for external CLIs"

### What it is
- "Agent harness control surface"~~ monorepo (`@t3tools/monorepo`, 3,833 commits, 1,049 branches, active nightly(today: v0.0.41-nightly.20260911)
- clients: desktop/web/mobile/server/marketing apps;; packages: client-runtime, contracts, effect-acp, effect-codex-app-server, shared, ssh, tailscale. Supports Claude Code, Codex, **Cursor**, Grok Build, OpenCode, Antigravity - the exact multi-provider "external CLI" row want.


### Why it's the right port base(not building blind}
- **`packages/contracts` (67 files, tested)**: THE shared contract layer - agentSessions, assets, auth, device, environment, git, ipc, editor, keybindings, model, baseSchemas... - crisp types/validators for agent+device+environment; maps 1::1 to our scaffolds' needs(native-session-init, runtime-permissions, native-endpoint-config, mcp-passthrough) We were going to design these from scratch - they're already designed+tested
- **`packages/effect-codex-app-server`**:a Codex app-server protocol package(client/protocol/rpc/schema/stdio - **generated from Codex's official schema**,with tests + mock peer + probe). Directly fills our `add-codex-native-support` scaffold - instead of implementing the Codex app-server protocol blind, port+refactor this (huge de-risk.
- **`apps/server/src`**: backend surface already built+tests: auth/ (EnvironmentAuth, PairingGrantStore, RpcAuthorization, ServerSecretStore}, orchestration/ (engine + provider adapters, integration-tested}, provider/ (per-provider adapters}, mcp/ (the 26 mcp-* branch surfaces: checkpoints,, controls,, conversations,, environment,, preview-controls,, projects,, queue-inputs,, scheduled-tasks,, terminals,, thread-search/state,, workspaces), processes/terminals/workspaces/device/cli/background/.... - the "optional backend for external CLIs" whole, already wrought
- **`apps/desktop/web/mobile`**:a full harness-control-plane product(mobile remote!!) - concepts to borrow(auth pairing,, remote control,, previews,, transfer budgets) even if we don't port the apps themselves


### What to port, in order (draft - for approval, not started)
1.. **`contracts` -> our shared package** (`src/shared` or new `packages/contracts`) - agentSessions/auth/device/environment/git/editor/model types+validators; adapt filenames/ids to maus; interop-tested(Feeds our add-native-* scaffolds')
2.. **`effect-codex-app-server` -> our codex-native impl**: port protocol/client/rpc/schema (keep generated schema tied to Codex's repo}, wire into our `add-codex-native-support` scaffold; delete meta-gen namespaces we don't use
3.. **server auth pairing** (EnvironmentAuth,, PairingGrantStore,, RpcAuthorization,, ServerSecretStore,, device/) -> our backend-auth design(replaces building our own device-pairing from scratch)
4.. **orchestration + provider adapters** (integration-tested} -> our "external CLI backend" execution engine(with our runtime-permissions ratchet wiring)
5.. **mcp surface** - port mcp server packages(controls/environment/projects/terminals/workspaces... in dependency order; each maps to a checkpointin our scaffold list)
6.. **apps surfaces** - borrow concepts only: transfer-budget,, previews,, remote/mobile pairing,, dev-server router(from sylvaindiv too )


### Port notes / care flags(t3code-specific}
- **Monorepo vs our app**: we're a single Electron app + future optional server; port **files/features**, notthe monorepo tooling(no workspace deps,, no tailscale/ssh - those are their infra; skip unless we need remote)
- **Dependencies**: t3 uses Effect platform heavily(effect-acp,, effect-codex-app-server}; contracts may carry effect/fp-ts deps - decision:: adopt effect for contract/adapter layers;; our app core stays as-is
- **License**: **MIT** (verified: LICENSE file,, T3 Tools Inc,, 2026) - clear to port with attribution
- **Tests**: port their tests along(contracts 67 = half tests;; codex-app-server fully tested} - they're the safety net that makes "port without building blind" survivable
- **Size**: do NOT boil ocean - this section is the *plan*; actual porting = separate feature branches,, one package/area at a time(contracts first},, reviewed per step(order above)


### Cross-references
- Our scaffolds this maps to:: add-codex-native-support,, add-runtime-permissions,, add-native-endpoint-config,, add-native-mcp-passthrough,, add-native-session-init(see openspec/changes/))
- Locus(lupanpan130} branch parallel:: effect-acp/conversations/orchestration concepts overlap - mining both,, prefer whichever is cleaner