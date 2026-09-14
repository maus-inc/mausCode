# mausCode ← Jules port plan — full implementation program

Status: **proposed, awaiting per-wave approval.** Author: Arena agent, 2026-09-12.
Scope source: `.dump/app/decisions/2026-09-12-jules-feature-triage.md` (54 changelog features, triaged
by the user: 34 accepted, 6 scoped behind the remote profile, 8 deferred, 6 rejected).

> **This is a plan, not an implementation.** Per `openspec/AGENTS.md` and this repo's convention, every
> wave below is an OpenSpec change that must be approved before code lands. Wave numbers double as the
> proposed change-ids. Nothing in this program is allowed to violate the performance rule in
> `CONTRIBUTING.md` ("no change may materially degrade runtime performance, memory, startup, rendering,
> or existing UI behavior without a benchmark and a justification recorded in `.dump/<domain>/`").

---

## 1. Evidence base (what was actually read)

Full-repo read of `arena/01a097c4-mauscode` @ `1a37e0b`, not a sample:

| Area | Size | Read |
|---|---|---|
| `src/main` (Electron main) | 251 files / 108,343 lines | all trees; `lib/runtime/*` in full; `lib/git/{github,git-operations,index,status}`, `lib/db/schema/index.ts`, routers `chats/claude-settings/github/runtime` in full or at procedure level; `trpc/routers` signature-mapped (36 routers wired in `createAppRouter`; `chats.ts` 2,326 L, `claude.ts` 3,197 L, `codex.ts` 1,987 L) |
| `src/renderer` | 448 files / 131,217 lines | all trees; `agents/ui/agent-diff-view.tsx` (2,178 L), `stores/sub-chat-store.ts` (430 L), `components/queue-processor.tsx`, `ui/{sub-chat-status-card,pr-status-bar}`, `sidebar/agents-sidebar.tsx` (3,380 L, section-mapped), `automations/*` (2,562 L), `main/{active-chat,new-chat-form}` (8,527 / 2,599 L) section-mapped, `hooks/usePRStatus/*`, `components/dialogs/settings-tabs/*` |
| `src/shared` | 84 files / 25,912 lines | `contracts/README.md` in full, all 35 contract modules enumerated + `agentSessions.ts`, `orchestration.ts` (2,251 L) read, `runtime-protocol.ts` in full, cross-reference grepped |
| `packages/runtime-client` | 25 files / 3,931 lines | `client.ts` method surface (58 methods), `structured.ts`, `protocol.ts`, `launch.ts` |
| `runtime/jcode` (vendored Rust) | 1,340 files / 695,234 lines | 82-crate inventory; `jcode-harness-api/{requests,events}.rs` (full request/event surface), `jcode-harness-api-server` capability advertisement, `jcode-memory-types/lib.rs`, `jcode-swarm-core/lib.rs`, `jcode-task-types`, `jcode-ambient-types`, `jcode-productivity-core`, `app-core/src/tool/*` registry, `docs/{AMBIENT_MODE,SAFETY_SYSTEM,HOOKS,MEMORY_ARCHITECTURE,SWARM_TASK_GRAPH}.md` |
| Docs / plans / audits | 39 `.dump` + 39 `openspec` files | `CLAUDE.md` (full, 11.1 kB), `AGENTS.md`, `CONTRIBUTING.md`, `README.md`; `docs/{protocol,backend-porting-recipe}` full + `docs/design-system-baseline.md` section map (§1.2 wash scale, §3.8, §4.4, §4.6, §9 audit method, §10 punchlist); `.dump/app/{README,second-brain}` + `research/{current-system-map,product-thesis,competitive-capabilities}` full, `decisions/user-decisions-2026-09-11`, `benchmarks/2026-09-11-p1-verification` (head), `.dump/ci/research/fork-network-harvest-catalog` (T3 deep-research section); all 13 `openspec/changes/*` with per-file task tallies; `.github/workflows/`, `scripts/ci/typecheck-ratchet.mjs`, `vitest.config.ts`, `.git/config`, `git-activity.ts`, `git-activity-badges.tsx` |

Everything below is anchored to a path I opened. Claims that are inference are marked *inferred*.

## 2. Six structural findings that set the shape of the program

**F1 — There is a 24,860-line domain model already in the repo, wired to nothing.**
`src/shared/contracts/` (ported verbatim from `pingdotgg/t3code` `packages/contracts` @ `211618f`, MIT,
headers intact) defines Effect/Schema types + validators for exactly the things Jules' changelog describes
that we would otherwise design from scratch: `pullRequest.ts` (1,265 L, `PullRequestChecksState`,
`PullRequestReviewDecision`, `PullRequestMergeability`), `orchestration.ts` (2,251 L, threads/turns/
approvals/attachments/`RuntimeMode`), `environment.ts` + `environmentHttp.ts` (843 L, placements/env
policy), `previewAutomation.ts` (951 L), `settings.ts` (1,408 L), `review.ts`, `device.ts`, `relay.ts`
(1,125 L), `agentSessions.ts`. `grep -rl "contracts" src/main src/renderer src/preload` → **0 importers**.
23 of its 67 `.ts` files are ported tests and they already run in CI (`test:contracts`). Measured again at `f5506b9` on 2026-09-14, `wc -l src/shared/contracts/*.ts | tail -1` gives 24,860 over 44 source files at 19,395 lines and 23 test files at 5,465 lines, and summing `grep -c ''` per file reproduces the same total, so 24,860 is the tree's count. `.dump/app/plans/contracts-adoption.md` §1 records 19,439, 5,488 and 24,927, each one line per counted file too high; `.dump/global/decisions.md` carries the correction.
→ The program's cheapest 30% is *consuming this layer*, not inventing parallel DTOs. `add-fork-harvest-transplants`
holds the T3 server phase (5/67) and notes this explicitly; that hold stays — we take the contracts we
already vendored, not their Effect runtime.

**F2 — The native runtime already contains most of Jules' autonomy; we are dropping it on the floor.**
`src/main/lib/runtime/translate.ts:147-168` explicitly `return []` for **22 harness events**, including
`session_status`, `connection_phase`, `background_progress`, `wake_requested`, `side_pane_images`,
`file_content`/`files`/`file_status`, `session_forked`, `message_accepted`. Meanwhile the daemon owns
`todo`, `bg`, `memory`, `batch`, `browser`, `webfetch`, `websearch`, `schedule`/ambient, `swarm`/`communicate`,
`goal`, `session_search`, `side_panel` tools (`runtime/jcode/crates/jcode-app-core/src/tool/`), plus
`jcode-plan` (DAG + mermaid), `jcode-overnight-core`, `jcode-ambient-types`, and a memory graph with a
4-step per-turn pipeline (search → verify → inject → maintain, `jcode-memory-types/src/lib.rs`).
`docs/AMBIENT_MODE.md`: single ambient instance, user-priority preemption, **self-scheduling** wakes,
resource-limited. That is Jules' Suggested Tasks + Scheduled Tasks + Memory, already written in Rust,
disabled by default and invisible to our UI.
→ Most waves are *exposure + policy* work in the app, not new agent capability.

**F3 — Run state is a lie waiting to happen, which caps every autonomy feature.**
`subChats.streamId` is set at turn start and cleared in a `finally` (`routers/runtime.ts`), so a renderer
reload or main crash leaves a stale `streamId` with no owner; the only queue is the renderer's
`queue-processor.tsx` with `QUEUE_PROCESS_DELAY = 7000` plus a 2 s "safety re-check" interval polling
streaming status; supervision is `MAX_RESTARTS = 3` exponential backoff in `runtime/manager.ts` with no
per-session notion of stuck-vs-running; `runtime.ts:108` refuses plan mode outright; `respondApproval`
returns `{reason:"unsupported"}` because the stock bridge advertises no `permissions` capability
(`add-runtime-permissions`: **5/20 tasks, needs a 9-step Rust patch, no Rust toolchain in the sandbox**).
→ **W1 (run integrity) and W2 (permission floor) gate everything unattended.** CI Fixer, Scheduled Tasks,
Suggested-Task auto-execution and PR-follow-up automation must not ship before them.

**F4 — "Open a PR" is currently `shell.openExternal` on a compare URL.**
`git/git-operations.ts:543-583`: pushes, builds `https://github.com/<owner>/<repo>/compare/<branch>?expand=1`,
opens the browser. Corrected 2026-09-13 after re-measuring (the earlier draft of this plan had two details wrong):
`chats.updatePrInfo` (`chats.ts:1657`) **does** have exactly one writer — a renderer-side regex scrape of Bash
output (`features/agents/utils/git-activity.ts:86` `extractPrInfo`, dispatched at `:137`, calling
`active-chat.tsx:2949`) — so the defect is not "nothing writes it" but "only a text-scrape writes it": an agent
that opens a PR through any other route leaves the row stale. Only two PR facts survive a restart at all
(`db/schema/index.ts:58-59`: `prUrl`, `prNumber`; nothing else is persisted, so a PR merged on GitHub cannot
settle the session).
The read path is better than the draft credited: `git/github/github.ts:24` `fetchGitHubPRStatus` resolves repo URL
→ current branch → `branchExistsOnRemote` and `getPRForBranch` in parallel, the latter being one
`gh pr view <branch> --json number,title,url,state,isDraft,mergedAt,additions,deletions,reviewDecision,statusCheckRollup,mergeable`
(`:91-105`, parsed with `GHPRResponseSchema`; shape at `git/github/types.ts:61-74`) — behind a flat 10 s cache keyed
by worktree (`:16-17`). Consumers: `active-chat.tsx:5366-5370` polls every 30 s, and `pr-status-bar.tsx:25-27`
polls every 30 s inside a component that **is never imported**. There is no `usePRStatus` hook. No `git rev-list`
ahead/behind or push-state derivation exists, so an already-pushed branch with no commits ahead renders as "ahead".
→ W5/W6 = keep that read path, **persist the snapshot**, one consumer, one refresh policy, real `gh pr create`,
and `baseComparison` + check de-duplication — see `.dump/app/research/2026-09-13-t3code-pr-state-spike.md`.

**F5 — The automations UI is a 2,562-line shell with no engine.**
`src/renderer/features/automations/{automations-view(272),automations-detail-view(916),inbox-view(957),
_components/*}` exists from 1Code as a hosted-21st feature: the only query in the whole folder is
`trpc.projects.list`. Triggers, templates, inbox and detail panes are presentational.
→ Jules' Scheduled Tasks (#8), edit/pause/resume (#9) and issue/inbox triggers (#10) get a **real local
engine behind an already-designed surface** — and it satisfies the "abstract inbox + GitHub adapter"
answer the user picked, rather than bolting a scheduler onto the chat list.

**F6 — Our own instruction layer is wrong, which is the exact bug class Jules' #31/#32 are about.**
`CLAUDE.md` (read in full, 11.1 kB) is not a stale map, it is a different repo's map: its Architecture tree
lists only `trpc/routers/` "(projects, chats, claude)" when `createAppRouter` wires 36
(`index.ts:49-86`); describes Claude integration as "Two modes: plan / agent" (we ship five: `plan|ask|edit|agent|turbo`); names the SDK
`@anthropic-ai/claude-code` while `package.json` pins `@anthropic-ai/claude-agent-sdk`; documents
`src/renderer/features/sub-chats/` (does not exist — the code is `features/agents/stores/sub-chat-store.ts`)
and a Debug Mode driven by `packages/debug/` (`ls packages` → `runtime-client` only). Its "Current Status
(WIP)" section lists "Git worktree per chat (isolation)" and "Claude Code execution in worktree path" under
**Planned** — both long shipped, along with 8 compatibility agents and a native runtime. `AGENTS.md` is only
the OpenSpec block. `openspec/project.md` still says "**[Testing approach not yet established - to be
defined]**" while the repo runs 65 test files across two runners, and its Tech Stack table omits `effect`,
pinned `4.0.0-rc.112` and load-bearing for `src/shared/contracts/`.
Worse, the two normative docs *disagree about the gate*: `docs/backend-porting-recipe.md` §9.1 demands
"`npx tsc -p tsconfig.json --noEmit` — zero errors (the baseline is 0)", while
`scripts/ci/typecheck-ratchet.mjs` blocks only **new** errors against `.github/ci-baselines/typecheck.txt`,
and `.dump/app/second-brain.md` records "tsc error set identical to baseline (99 = 99)". An agent following
one file and an agent following the other will do different work.
→ **W0 is instruction-layer truth.** Jules' own reliability note was "better at following your instructions
in agents.md" — the files our agent obeys must be right, and must not contradict each other.

**A note on the trigger label:** `.github/workflows/` contains only `ci.yml` and `lock-regen-temp.yml` —
this repo has no `jules-ci` / `jules-label-agent` workflow, no `label:*` git-config keys, and no GitHub App
or webhook endpoint to receive events. W7's trigger label therefore defaults to `mauscode`, is configurable
per project, and is implemented over `gh api` **polling**, not pushed events.

## 3. Program architecture

New main-process modules, laid out per `docs/backend-porting-recipe.md` §2 (a directory per subsystem with
adapter + colocated `*.test.ts` + `test/fixtures/` mock + `README.md` port log), routers kept as
orchestration per `openspec/project.md`:

```
src/main/lib/runs/            lifecycle.ts · queue.ts · evidence.ts      (W1)
src/main/lib/orchestration/   graph.ts · supervisor.ts · budget.ts        (W3)
src/main/lib/critique/        planner-critic.ts · code-critic.ts · schema.ts   (W4)
src/main/lib/autopilot/       ci-fixer.ts · schedules.ts · scanner.ts · pr-feedback.ts (W6,W7,W9)
src/main/lib/knowledge/       memory-store.ts · instructions.ts           (W10)
src/main/lib/changeset/       changeset.ts · patch.ts                     (W5)
src/main/lib/server/          sessions-api.ts  (extends the existing loopback server)  (W8)
src/shared/protocol/          maus-extensions.ts · orchestration-protocol.ts            (F1, I-1)
src/main/lib/t3/              decode.ts (Effect-schema boundary adapter)               (F1)
```

Rules these must obey, from the existing corpus: **I-1** UI never imports runtime internals; **I-2**
workspace/placement independence (nothing in `autopilot/` may assume local — see W13); **I-4** native never
depends on a compatibility adapter; **I-5** secrets are refs at every boundary (no tokens in args, logs,
telemetry or transcripts); **I-6** every wave ships a benchmark record in `.dump/app/benchmarks/`.
The T3 contracts boundary (F1) is *one-way*: `src/main/lib/t3/decode.ts` is the only place outside
`src/shared/contracts/` that touches `effect/*` — the rest of the app keeps zod/Drizzle shapes. Per
`docs/protocol.md` §6, PTY/git/scheduling stay out of the runtime protocol; scheduling therefore lives in
the app (`autopilot/schedules.ts`) driving sessions, not in a new `maus.schedule` verb — with one
exception and one reservation: `maus.taskgraph` is already reserved in §3 for the W3 task DAG.

Persistence (Drizzle only, `npm run db:generate` — never hand-edit `drizzle/`): extend, don't replace.
New tables `runs`, `run_events`, `orchestrations`, `sub_chat_links`, `critiques`, `evidence_bundles`,
`ci_fix_attempts`, `schedules`, `schedule_runs`, `suggestions`, `inbox_items`, `pr_comment_actions`,
`memory_entries`, `authorship_settings`; plus columns on `chats` (already holds `worktreePath`,
`branch`, `baseBranch`, `prUrl`, `prNumber` — add `headSha`, `prState`, `pushedAt`, `autoFixPolicy`) and on
`sub_chats` (already holds `sessionId` = daemon id, `streamId`, `mode` = 5 agent modes, `provider` — add
`parentSubChatId`, `role`, `budgetTokens`). `sub_chats.messages` stays a JSON blob for now (F1/F3 note:
`current-system-map.md` §5 flags it as the scaling risk; the daemon owns transcripts, so `run_events` is
the audit trail and the blob stays display cache — the deferred item #16 is the correct place to fix it).

## 4. Waves

Each wave: **OpenSpec change-id · depends on · design · task checklist · tests · gate · Jules items covered.**

### W0 — Ground truth and the contract seam · `update-instructions-and-contract-seam` · depends: none

The one wave with no user-visible feature; it is what stops the other thirteen from drifting the way
`CLAUDE.md` already did.

- [ ] Rewrite `CLAUDE.md` against the tree as read: 20 routers, one line each (incl. `runtime`, `github`,
      `usage`, `voice`, `sandbox-import`, `hermes` and the 6 print-adapter routers (cursor, grok, qwen, cline, openclaw, roo)); the five agent modes;
      `@anthropic-ai/claude-agent-sdk`; the `lib/runtime/` host + `packages/runtime-client` (harness-api v1
      NDJSON, 58 client methods); `src/shared/contracts/` with a pointer to its README boundary rules;
      `runtime/jcode` (vendored JCode, MIT, stock at `ce4e789`); `scripts/ci/` ratchets; `benchmarks/`; the
      `.dump`/`openspec` conventions; and the real commands, including the fact that `build` is preceded by `prebuild: npm run
      build:runtime-client` — `@maus-inc/runtime-client` is a `file:packages/runtime-client` workspace dep
      resolving to its `dist`, and `tsconfig.json` `paths` maps only `"@/*" → ./src/renderer/*` (nothing for
      the runtime client), so a stale or missing `dist` breaks main-process typecheck confusingly. CI installs
      with `--ignore-scripts` and builds that package explicitly, for exactly this reason.
- [ ] Its Commands section lists 6 of the 20 `package.json` scripts: add `test`, `test:contracts`,
      `test:node`, `lint`, `typecheck`, `ratchet:typecheck`, `ratchet:audit`, `ts:check`, `db:push`,
      `db:studio`, `icon:generate`, and the pinned binary downloads (`claude:download` 2.1.45,
      `codex:download` 0.137.0).
- [ ] Delete `CLAUDE.md`'s Debug Mode section (points at a `packages/debug/` that does not exist) or vendor
      the package. Never leave a dangling pointer in an instruction file.
- [ ] Replace "Current Status (WIP)" with a dated pointer to `.dump/app/second-brain.md`, which is the file
      that is actually maintained — a status list inside an instruction file is how this drift happened.
- [ ] `openspec/project.md`: fill the empty Testing Strategy section (two runners, what belongs in each, the
      fixtures-mock pattern) and add `effect` + pin + why the pin exists to the Tech Stack table.
- [ ] Close the gate question named in F6 rather than adjudicate it: `.github/ci-baselines/typecheck.txt` is now
      **empty** (a single newline, measured 2026-09-13), so the ratchet already permits **zero** typecheck errors —
      recipe §9's "the baseline is 0" is true today, by accident. Write it down as policy: baseline entries need a
      linked issue and an expiry note, **new files** are always zero-error (what `add-native-local-execution`
      demonstrably did: "zero errors in any P1-new file"), and `package.json:31` `"ts:check": "tsgo --noEmit"` is
      either wired into CI or deleted (it currently duplicates `typecheck` at `:39` with a different compiler).
- [ ] `AGENTS.md`: keep the OpenSpec block; append a 6-line "authoritative pointers" list (design-system
      baseline, protocol, backend recipe, perf rule, provenance rule, `.dump` curation standard).
- [ ] `src/shared/protocol/maus-extensions.ts`: TS mirror of the `maus.*` names reserved in `docs/protocol.md`
      §3 with an implemented/reserved table (all reserved, none implemented).
- [ ] `src/main/lib/t3/decode.ts` — marked **NOT verbatim** per recipe §0, since all mausCode behavior lives
      in adapters: validation entry points for the contract schemas a wave actually consumes, one test per
      schema, and a header table naming which of the 35 modules are still unused, so the layer cannot
      silently fossilize a second time.
- [ ] Make `vitest.config.ts` explicit about the two runners: today `include: ["src/**/*.test.ts"]` already
      sweeps up the 23 contract tests while CI separately runs `test:contracts` — the same files twice, and
      neither command documents which tests it is meant to own.
- Gate: `npx tsc -p tsconfig.json --noEmit` shows no new errors vs `.github/ci-baselines/typecheck.txt`
  (`node scripts/ci/typecheck-ratchet.mjs --report`; `--update` only if the count strictly falls). `bun` and
  `tsgo` are absent in this sandbox — the P1 record says so in terms ("Repo-blessed `ts:check` (tsgo) cannot
  run: binary not installed in this env") — so `ts:check` is recorded as a CI-owned handoff, never as done.

### W1 — Run integrity: kill the stuck-session bug class · `add-run-integrity` · depends: W0

Covers the user's accepted **partial** of Jules #50 ("only the stuck-session half") and the honest
substrate for #53, #44, #8, #1, #23. No queue/backpressure hardening beyond fairness, no state-machine
rewrite, no responsive work — those stay deferred.

- [ ] `src/main/lib/runs/lifecycle.ts`: one `RunState` union — `queued | starting | running | awaiting_input
      | backgrounded | succeeded | failed | cancelled | stale` — owned in main, per sub-chat, persisted in
      the `runs` table with `phase`, `heartbeatAt`, `daemonSessionId`, `engine` (`native | legacy`).
      Reconcile on app start: any run with `streamId` but no live owner becomes `stale` + a user-visible
      "recover / retry / mark failed" affordance (today it silently looks alive).
- [ ] Stop swallowing the events that carry run truth — but **do not extend the chunk dialect to do it**.
  `translate.ts:147-168` `return []`s 22 events including `session_status`, `connection_phase`, `background_progress`,
  `wake_requested`, `file_*`, `history`, `models`, `message_accepted`, `session_forked`; recipe §4 pins the
  dialect to text/tool/terminal chunks and forbids unknown chunk types, and §0 forbids touching the renderer
  for backend work. So the fix is a **side channel**: `runs.subscribe { subChatId }`, a tRPC subscription
  carrying `RunState` plus the daemon's own `BackgroundProgress {taskId,label,percent,summary,done}` —
  whose rationale in `events.rs` is verbatim our use case ("any API client can draw the same bar instead of
  leaving the user with a spinner that says only 'still working'"). Every still-swallowed case gets a comment
  naming why, so the list shrinks on purpose rather than by accident.
- [ ] `run_events` append-on-transition (bounded, retention-pruned alongside
      `client.setRetentionPolicy`), giving every wave below a place to attach audit records. Keep it a
      transition log, *not* the deferred full activity log (#16) — same table, additive later.
- [ ] Watchdog: recipe §11 sets "turn watchdog (none by default — agents run long)", so this is a
  *detector*, not a killer. No status change for a configurable window (default 120 s) while `running` →
  `awaiting_input` + a "still working?" card offering nudge (`softInterrupt`) / inspect / cancel. Never
  auto-cancel; never interrupt a backgrounded tool; reuse `manager.ts` supervision, do not start a second.
- [ ] Tell the truth in the other direction too: recipe §6 requires `resultSubtype: "error"` only on real
  errors so an interrupt doesn't render a Failed badge, and `multi-backend-program` task 6b (still open) is
  exactly that unfinished work for `claude.ts`. W1 closes it.
- [ ] Move the queue into main: `src/main/lib/runs/queue.ts` — per-sub-chat FIFO + global concurrency cap
      (default = `max(2, min(cores/2, 5))` to echo Jules' 5-concurrent ceiling) with priority
      `interactive > pr-feedback > schedule > suggested` and **user preemption** for background classes
      (mirror `AMBIENT_MODE.md`'s "interactive sessions always take precedence"). Renderer
      `queue-processor.tsx` becomes a view over it: delete the 7 s sleep and the 2 s poll.
- [ ] Legacy path parity: the same lifecycle must drive `claude.ts`/`codex.ts` sessions, since they still
      own `activeSessions`/`activeStreams` maps (`current-system-map.md` §3) — W1 is the seam they meet at,
      not a native-only island.
- [ ] Status truthfulness in the shell: `sub-chat-status-card.tsx` and the sidebar consume `RunState`
      (one source), replacing independent local guesses.
- Tests: unit for every transition (including stale-reconcile), queue fairness/priority/preemption,
  translate mapping per event; fake-timer watchdog tests via the existing `vi.useFakeTimers()` pattern
  (`src/main/lib/opencode/session.test.ts`); `node --test` for runtime-adjacent pieces.
- Gate: `benchmarks/` run — event throughput + chunk→paint unchanged at 1/5/25 sessions; memory delta
  from `run_events` bounded and pruned. Record in `.dump/app/benchmarks/2026-xx-xx-w1-run-integrity.md`.
- Covers: #50 (partial), enables #53/#44/#8/#1/#23.

### W2 — Permission floor for unattended work · `add-permission-policy` · depends: W1

Blocks W4–W7, W9. Two tracks so the sandbox's missing Rust toolchain can't stall the program.

- [ ] Track A (Rust, CI/dev-owned — the 15 open items in `add-runtime-permissions/tasks.md`, spec is
      already written): land the stdin-mirror patch, advertise the `permissions` capability, bump
      `API_VERSION_MINOR`, `record_decision` audit on every answer. Keep `runtime/jcode` stock until that
      patch lands; record it in its `UPSTREAM.md` patch list.
- [ ] Track B (app-side, sandbox-buildable): real read-only enforcement for **plan mode** on native
      (`runtime.ts:108` refuses today) via a `pre_tool`-style gate in the translator/manager — allow
      `read`/`search`/`list` tool kinds, deny mutations with an explicit refusal message; unblocks plan mode
      and makes "read-only scan" a promise instead of a prompt.
- [ ] `~/.mauscode/permissions.toml` managed default policy: deny-by-default for destructive/network/exfil
      classes, allow-with-approval otherwise, per-project overrides; **never port `bypassPermissions`**
      (`docs/protocol.md` §5 is binding). Model the tier structure on `jcode-command-risk` +
      `bash_destructive_gate.rs` so daemon and app agree on risk vocabulary; port the vocabulary, not the
      crate.
- [ ] Persistent review queue surfaced in settings (the `SAFETY_SYSTEM.md` shape: auto-allowed vs
      requires-permission, with a durable review list) so unattended work that hit a gate is
      inspectable and reversible.
- [ ] Wire `respondApproval` end-to-end (currently `{reason:"unsupported"}`) + the approval card in the
      composer (`agent-user-question.tsx` / `ask-user-question` chunk path exists).
- Tests: one test per allow rule (rule from `current-system-map.md` §17 row 5: "every allow rule needs a
  test"); policy-decision table tests; detach-deny and timeout-deny exercised live, not by reading code.
- Gate: approval latency (request→card→resume) benchmarked; zero behavior change for `turbo` interactive.
- Covers: safety prerequisite for #1, #2, #3, #6, #7, #8, #11, #33 (enforcement), #52.

### W3 — Sub-chat orchestration ("threadmaxx") · `add-subchat-orchestration` · depends: W1, W2

The user's escalation of #23, with all three modes selectable.

- [ ] Schema: `sub_chat_links(parentSubChatId, childSubChatId, role, origin, createdAt)`,
      `orchestrations(id, parentSubChatId, mode: fanout|supervised|orchestrator, concurrency,
      budgetTokens, usedTokens, status, planRef, createdAt)`.
- [ ] `src/main/lib/orchestration/graph.ts`: **plan-item → sub-chat** — read the plan the agent produced
      (`agent-plan-tool.tsx` / `plan-widget.tsx` already render plans; `jcode-plan`'s `PlanItem` + DAG is the
      shape; use its `dag/` semantics for dependency edges rather than inventing one), then create N child
      sub-chats each pre-seeded with its item as the opening prompt, in the same chat/worktree by default
      with per-child `isolation: "branch"` opt-in. Reuse `chats.forkSubChat` (`chats.ts:913`) and
      `client.forkSession` (`packages/runtime-client/src/client.ts:464`) — fork-based children inherit the
      parent's context cheaply, which is what "perfectly continue /chat those subchats" asks for.
- [ ] `supervisor.ts`: per mode —
      `fanout`: spawn + navigate, human drives each child;
      `supervised`: parent may prompt children (`sendMessage` to child session), monitor
      (`RunState` + `peekSession`), request reports, cancel/restart;
      `orchestrator`: a dedicated parent agent turn with a token budget that fans out, gathers, and merges
      results back, and may only open new work through the supervisor (never raw bash git).
- [ ] Report channel: adopt `jcode-swarm-core`'s discipline verbatim in TS
      (`src/shared/protocol/orchestration-protocol.ts`): completion report ≤ 4 000 chars, `tldr` required
      for any body > 240 chars and ≤ 200 chars, one line only — so parents' context doesn't fill with child
      transcripts. Enforce with `validateSwarmTldr`-equivalent and test all four branches.
- [ ] Budget + fairness: per-orchestration token budget, child concurrency capped by W1's queue, hard
      member ceiling (JCode's is 1000 — ours should start at 5 like Jules' `--parallel`, configurable).
- [ ] UI: sub-chat tree in the sidebar (children indented under parent, per-child `RunState` chip),
      `sub-chat-selector.tsx` gains tree mode (1,035 L — extend, don't rewrite), an orchestration card on
      `sub-chat-status-card.tsx` (spawn-per-plan-item / nudge / gather / cancel-all), and a budget meter.
      Design system §4.4 (sub-chat tabs) + §1.2 wash scale are binding; `sky-500` and
      `bg-foreground/[0.08]` are forbidden.
- Tests: graph transitions, tldr validation, budget accounting, fork-inherit semantics against the mock
  harness (`packages/runtime-client/test/mock-harness.ts`), worktree-collision cases for `isolation: branch`.
- Gate: this is the wave most likely to cost memory (N sessions) — measure 1/5/25 sessions RSS and the
  ~9.9 MB/extra-client figure we're benchmarking against (`current-system-map.md` §16). If the delta is
  worse, shrink default concurrency before shipping, not after.
- Covers: #23 (escalated).

### W4 — Critic layer · `add-critic-agents` · depends: W1, W2, (W3 for plan shape)

#2 Planning Critic, #3 code critic, #4 streamed transparency, #5 interactive plan.

- [ ] `src/main/lib/critique/planner-critic.ts`: fires **only on auto-approved plans** — i.e. no human plan
  approval happened (agent/turbo entry, scheduled/suggested/CI-fixer/automation-originated runs). Reads
  prompt + plan + repo signals, emits a refined plan + issue list through
  `JcodeClient.runStructured` (`packages/runtime-client/src/structured.ts` — JSON-Schema-validated,
  bounded retries, already built) against `critique-plan-v1`. Persist to `critiques(runId, kind,
  issues[], revisedPlan, modelRef, createdAt)`.
- [ ] `code-critic.ts`: pre-completion adversarial pass over the *change set* (from W5's `getChangeSet`),
  one improvement round by default (`maxRounds` config, 3 ceiling); a `critique-v1` schema whose findings
  are `bug | edge-case | security | perf | test-gap` with file:line anchors so they're checkable.
- [ ] Transparency: emit critic reasoning as its own chunk kind (`critic-reasoning`) rendered like
  `agent-thinking-tool.tsx` but labeled "Critic", live while it runs — this is the whole point of #4.
  `plan-section.tsx` / `plan-widget.tsx` show the diff between the original and critic-revised plan.
- [ ] Policy: default **on** for unattended runs (where Jules measured the 9.5 % failure reduction), default
  **off** for interactive `turbo`, per-project override in settings. Every critic call goes through W1's
  queue at `priority: critic` so it can't starve interactive work.
- [ ] #5 Interactive Plan: `plan` mode gains an explicit clarify loop — `ask-user-question` chunks are
  already the native question channel (`runtime-protocol.ts` `NATIVE_QUESTION_PREFIX`), so add
  `propose-plan → questions → revise → approve/edit` as a bounded exchange (max 3 rounds) before execution,
  and a "brainstorm with me" toggle in the composer's mode selector (`work-mode-selector.tsx`).
- Tests: schema-contract tests per critic; "auto-approval gate fires / doesn't fire" tests; round bounds;
  prompt-injection resistance (critic must not treat repo text as instructions — mirror the
  untrusted-import posture from `docs/protocol.md` §5).
- Gate: measure added wall-clock + tokens per auto-approved run and publish it — this feature buys
  reliability with latency, so the trade must be a number, not a claim.
- Covers: #2, #3, #4, #5.

### W5 — Evidence, export, real PRs, machine-parsable change set · `add-changeset-and-publish` · depends: W1

#15 file outputs, #40 export anytime, #41 open a PR, #52 test-verified contract, and the substrate for #1.

- [ ] `src/main/lib/changeset/changeset.ts`: build the change set for a chat from existing primitives
  (`git/utils/apply-numstat.ts`, `utils/parse-status.ts`, `diff-parser.ts`, `git/diff-parser.ts`) into
  `{ files: [{ status: A|M|D|R, path, additions, deletions }], totals: {files, additions, deletions},
  patch }` — exactly the `[M] bun.lock +567 -163` shape from the changelog, and the same object both the
  diff UI and W8's API render. `patch` is a real `git diff` string (the changelog's "stored in a git patch
  format for parsing additions, modifications, and deletions").
- [ ] `chats.getChangeSet { chatId, ref? }` query + `chats.downloadChangeSet` returning a `.patch`
  (`shell.saveFile` via `window.desktopApi`, or `file://` temp path — no new IPC channel needed).
- [ ] Publish-now: `runs.exportNow { chatId, subChatId?, as: "branch" | "pr", draft?: boolean }` — commits
  WIP with an explicit `wip:` prefix, pushes, optionally opens a PR — available mid-run without asking the
  agent, i.e. #40's "you don't have to wait for a task to finish". Build on `usePushAction` +
  `diff-sidebar-header.tsx`'s existing three-state logic (`!hasUpstream → Publish Branch`), and add the
  menu item to `agent-diff-view`'s toolbar, which already has a context-menu affordance for paths
  (`agent-diff-view.tsx:857-863`).
- [ ] Make `changes.createPR` real: `gh pr create --json number,url,title --base <baseBranch> --title …
  --body-file -` (title/body generated from commits + plan + evidence summary; draft by default for
  automation-originated PRs), then `chats.updatePrInfo` (`chats.ts:1657`) so `prUrl`/`prNumber` stop being
  write-orphaned. Keep the current `openExternal(compare)` path as a *named fallback* when `gh` is absent,
  with a one-line reason in the UI instead of a silent downgrade.
- [ ] Completion contract (#52): `evidence.ts` produces an `EvidenceBundle { tests: {cmd, exitCode,
  durationMs, outputExcerpt}, changeSet, critic?: critiqueId, screenshots?: [] }`. A run may not be marked
  `succeeded` — and `exportNow`/`createPR` refuse — when the run changed files, `requireEvidence` is on
  (default **on** for unattended/scheduled/suggested/CI-fix runs, off for interactive), and no passing test
  evidence exists. Refusal message tells the user what's missing and offers "run tests" or "publish
  anyway" (explicit override, logged to `run_events`).
- [ ] Stop deriving PR identity from pasted text: `active-chat.tsx:2939-2949` regex-scans assistant message
  text for a `github.com/<owner>/<repo>/pull/<number>` URL and calls `chats.updatePrInfo` from the
  **renderer** — so `prUrl`/`prNumber` land only if the agent pastes a bare PR URL *and* that view is
  mounted. Move the write into main (`createPR` records its own result, plus `runs.exportedSha`); keep the
  scan as a repair path for legacy rows, not the mechanism. This is the real "PR not detected" bug, and it is
  what the user's "high-end QoL state detection" ask should replace.
- [ ] One PR-state consumer: replace the three pollers (`github.ts` 10 s cache, `usePRStatus` 10 s,
  `pr-status-bar` 30 s) with `pullRequestState.ts` — derive `pushed` (ahead/behind via `git rev-list`),
  `prNumber` from `chats`, PR state from `gh pr view --json`, invalidate from the existing git watcher
  (`git/watcher/git-watcher.ts`) instead of polling on a timer; keep the TTL cache, drop the intervals.
  Reuse `PullRequestChecksState`/`PullRequestReviewDecision`/`PullRequestMergeability` from
  `src/shared/contracts/pullRequest.ts` via `t3/decode.ts` (F1) — don't redefine them.
- [ ] Retire transcript-scraping as a source of truth. `src/renderer/features/agents/utils/git-activity.ts`
  (253 L) derives the chat's commit/PR badges by parsing the `command` + `stdout` of `Bash` tool parts
  (`extractCommitInfo` `:46`, `extractPrInfo` `:86`, `extractGitActivity` `:111`) — so a hand-made commit, a
  failed `gh` call, a rebase, or a run on any non-Claude engine renders as "nothing happened". Keep that
  parse for the *per-run activity narrative* (that is genuinely what it is) and point badges at
  `pullRequestState` + `runs.exportedSha`. Verified consequence today: `chats.updatePrInfo` is only called
  from the manual renderer path, so `chats.prUrl`/`prNumber` go stale whenever the agent runs `gh pr create`
  itself inside a turn.
- [ ] **Spike outcome (2026-09-13, read-only, `/tmp/t3code` @ `8ddd9f7e`).** The PR model this wave needs is
  already vendored and dead in our tree: `src/shared/contracts/orchestration.ts:630-637`
  (`ThreadPullRequestLinkSource = manual | created | agent | stack | stack-dismissed`), `:644-662`
  (`ThreadPullRequestSnapshot`: `state, title, headBranch, baseBranch, isDraft, updatedAt, syncedAt` + optional
  `closedAt, mergedAt, author, additions, deletions, changedFiles, reviewDecision, checksState, mergeability`),
  `:685-699` (`ThreadPullRequestKey`/`Link`, host+repository+number), `:1151` link command, `:1475` sync command,
  `:1684` `ThreadPullRequestLinkedPayload`, and `pullRequest.ts:120`
  (`PullRequestBaseComparison = up-to-date | behind | unknown`, at `pullRequest.ts:124`). **W5 therefore designs no vocabulary**: it
  persists those snapshot fields beside `prUrl`/`prNumber` (`prSource`, `prLinkedAt`, `prSyncedAt`, `prState`,
  `prChecksState`, `prMergeability`, `prBaseComparison`) as zod-validatable Drizzle columns, keeping the
  contracts-seam boundary from W0.
- [ ] Discovery rule is t3code's, not an inference: a PR belongs to a chat when the PR's `headRefName` equals the
  worktree's branch **and** the remote repository URL matches (`GitManager.ts:379`, with their explicit guard at
  `:1463` against auto-settling an unrelated feature thread). Never from branch-name shape, never from
  `gh pr list` recency. Manual linking keeps working, recorded as `prSource: "manual"`, so agent-opened PRs stay
  distinguishable from user-opened ones.
- Tests: changeset parsing against a fixture repo with renames/deletions/binary/empty-diff/unicode paths;
  evidence gating matrix; export-now while running; PR-state derivation with mocked `gh`
  (the `src/main/lib/*-print/test/fixtures/*-mock.mjs` pattern is the precedent for stubbing binaries).
- Gate: no new polling (assert zero `refetchInterval` in the diff/PR path in a test); `git status` cost
  unchanged at 25 worktrees.
- Covers: #15, #40, #41, #52, partial #50 (export reliability).

### W6 — CI Fixer + PR-state-aware sidebar · `add-ci-fixer` · depends: W2, W5

#1 CI auto-fix loop and the user's redirected #24 ("auto pr detecting with high end qol
state detection like t3code nightly did it").

- [ ] `autopilot/ci-fixer.ts`: subscribe to the PR-state consumer; when `checksStatus === "failure"` on a
  PR this app created, ingest failure detail (`gh pr checks --json`, `gh run view --log-failed` truncated
  to a bounded tail), open a fix run in the same worktree at `priority: pr-feedback`, push, and loop
  (cap 3 attempts, exponential backoff, `ci_fix_attempts` table for audit). Stop conditions: green,
  attempts exhausted, a gate denies, or the human posts a comment (W6b takes precedence).
- [ ] Scope guard mirroring Jules' limitation: only PRs whose head branch equals `chats.branch` **and**
  which we authored (`prNumber` set by us). Anything else → notify only.
- [ ] `autopilot/pr-feedback.ts` (#11): poll `gh pr view --json reviews,comments` +
  `gh api repos/…/pulls/N/comments` (review-thread + inline), react 👀 via
  `gh api …/reactions -f content=eyes`, then either act (fix run) or, in **Reactive Mode** (user-level
  setting), wait for `@mauscode`/`@claude` mentions. Reply with a summary comment referencing the fix
  commit. Reuse `review.ts`'s shapes via the contract seam.
- [ ] Sidebar state detection (the #24 redirect): extend `projects-rail.tsx` /
  `agents-sidebar.tsx` rows to consume `pullRequestState` — `dirty | pushed | pr-open | changes-requested
  | ci-failing | ci-fixing(n/3) | ready | merged` as one dense chip row, plus ahead/behind counts. Do the
  **spike the user asked for first**: shallow-clone `pingdotgg/t3code` (MIT), read the
  `@t3tools/contracts` PR/state modules + desktop rail code, and write the findings to
  `.dump/app/research/2026-09-xx-t3code-pr-state-spike.md` (method precedent:
  `.dump/ci/research/fork-network-harvest-catalog.md`'s "Deep-research: T3 Code" section). Steal
  states + copy, not their Effect runtime. `add-fork-harvest-transplants` Phase 5 remains a *hold*: no T3
  server adoption, and no new dependencies (CI runs a Dependency-review job plus `scripts/ci/audit-ratchet.mjs`, so hand-roll what is small).
- [ ] **Spike outcome (2026-09-13): take their refresh policy wholesale, not their runtime.** Measured in
  `GitManager.ts:137-164`: PR lookups cache 60 s **on success** and back off exponentially 20 s → 15 min **on
  failure**, because (their words) a hosting provider rejects a throttled request immediately, so caching a failure
  at the success TTL "turns a transient 429 into a 60 s blind window"; branch-status reads get `Duration.zero` TTL
  on failure (`:1001`, `:1272`); cache keys are NUL-joined (`:1020`); one invalidator clears reads
  (`PullRequestReadCache.ts:95`). Our flat 10 s cache (`git/github/github.ts:16-17`) has no failure branch at all,
  which is *why* the sidebar currently lies under rate limiting. Replace it with the same two-mode policy expressed
  in plain TS (no Effect, no dependency).
- [ ] Vendor `apps/server/src/pullRequest/pullRequestChecks.ts` (55 lines, **Effect-free** — one type import; MIT)
  and its test for check de-duplication: one row per check qualified by workflow, newest run wins, ties to the
  later row, order held where each check first appeared, so a re-run replaces a row in place instead of
  reshuffling the panel. This is the only piece of their PR layer needing no translation; the 2,456-line
  `GitHubPullRequestCli.ts`, four-host provider registry and Effect `Cache` service stay references we adapt.
- [ ] Use the reaction vocabulary we already own for #11's 👀 marker instead of inventing one:
  `src/shared/contracts/pullRequest.ts:165` `PullRequestReactionContent` + their
  bidirectional `REACTION_CONTENT_BY_GITHUB` map (`gitHubPullRequestJson.ts:264-290`) — an unmapped reaction today
  reads as "no reaction".
- Tests: fixture-driven check runs (`gh` mock); loop bounds; reactive-mode gate; scope guard; dedupe when
  the same failure re-reports.
- Gate: idle cost must be ~zero — no work when nothing is open; CI-fix runs must never raise peak
  concurrency above W1's cap.
- Covers: #1, #11, #24 (redirected).

### W7 — Proactive scanning + inbox triggers · `add-suggestions-and-inbox` · depends: W1, W2, (W5 for plans)

#6 TODO mining, #7 performance findings, #10 issue-label trigger as abstract inbox + GitHub adapter.

- [ ] `autopilot/scanner.ts`: incremental scan of a project's worktree with content-hash caching
  (precedent for the cache-then-scan discipline: `jcode-productivity-core/src/scan.rs` +
  `git/cache/git-cache.ts`). Two detectors behind one interface:
  `todo` (TODO/FIXME/XXX/HACK + owner markers, with surrounding-context extraction to form a plan draft)
  and `perf` (heuristic classes with a static prefilter only — loop-side effects, sync-in-hot-path,
  N+1-shaped awaits, unbounded reads, per-iteration regex/allocation — **no** LLM scan of the whole repo:
  that's how we keep the perf promise). Respect `.gitignore` + `security/path-validation.ts` rules.
- [ ] `suggestions` table: `id, projectId, kind, path, line, excerpt, score, planDraft, status
  (new|planned|running|dismissed|done), evidenceRunId, createdAt, decidedAt`. Per-project enable toggle
  (Jules' "enable the proactive suggestions toggle"), and `dismissed` is sticky by content hash so we
  never re-nag the same line.
- [ ] `inbox_items` (the abstract half of #10): `id, source, externalKey, title, body, projectId,
  status, dedupeKey unique` + `TriggerSource = github-label | kanban-card | note | schedule | manual`
  behind one `promoteToSession(inboxItemId, {mode, planDraft})` entry point. The existing Kanban and
  archive surfaces gain "run in mausCode" via the same call — this is what makes it not-GitHub-specific.
- [ ] GitHub adapter: `gh api` **polling** (default 5 min, single shared scheduler tick, no new webhook
  infra and no tunnel), configurable label defaulting to `mauscode` (never colliding with this repo's own
  `jules/*` labels — see §2 note), claim semantics (swap to `mauscode/running`, on failure
  `mauscode/needs-human`, so a stalled run is visibly someone else's turn),
  dedupe by issue number + updated_at.
- [ ] Wire the real engine behind `automations/inbox-view.tsx` (957 L of already-built shell) — replace
  the mock/hosted data path with `trpc.inbox.*`; keep the design language.
- [ ] Approval UX: from the Suggested-task surface, "plan this" → creates a chat (or sub-chat, W3) with
  the drafted plan pre-loaded and `awaiting_input` for the human — Jules' "formulates a plan and presents
  it for your approval".
- Tests: detector fixtures (a tiny repo with known TODOs + one N+1), incremental-cache correctness
  (rename/edit/delete/noop), dismiss stickiness, claim/dedupe races, label-config parsing.
- Gate: **scan cost is the whole ballgame** — measure per-project scan wall-time + RSS on a large tree,
  run at `priority: suggested`, yield immediately to interactive (`AMBIENT_MODE.md` user-priority rule),
  and prove idle → 0 CPU. Record before/after in `.dump/app/benchmarks/`.
- Later consolidation (not this wave): once `maus.*` scheduling exists in the runtime, moving the scanner
  behind the daemon's ambient loop is the cleaner shape — noted so W7 isn't mistaken for the end state.
- Covers: #6, #7, #10 (as inbox + adapter).

### W8 — Local Sessions API + scratch sessions · `add-sessions-api` · depends: W5, W1

#13 sessions API, #14 repoless (reinterpreted), #21's deferred value comes free.

- [ ] Extend the loopback server that already exists for auth callbacks (`src/main/index.ts:283-464`) into
  `src/main/lib/server/sessions-api.ts`, sharing handlers with tRPC so there is one `sessionsService`
  behind both. Endpoints: `POST /v1/sessions` (`{prompt, projectId | scratch, baseBranch?, mode?,
  images?, attachments?}`), `GET /v1/sessions/:id`, `GET /v1/sessions/:id/activities?after=<ts>` (cheap now
  — reads `run_events`; it's the hook that makes deferred #16 a config change later, and where the
  immutable, cacheable, event-sourced property gets designed in), `GET /v1/sessions/:id/changeset`,
  `GET /v1/sessions/:id/changeset.patch`, `POST /v1/sessions/:id/cancel`.
- [ ] Security: bind `127.0.0.1` only, **off by default** with an explicit enable in settings, bearer token
  generated + shown once, stored via `safeStorage` (never `base64`), no tokens in query strings, secrets
  redacted from logs, per-request origin allowlist on the loopback port. `docs/protocol.md`'s "no
  HTTP/REST translation on the hot path" stays honored — this is a *control plane* surface for
  create/cancel/status, never a token-streaming path; the streaming path remains NDJSON-over-socket to the
  daemon, and the API hands out an activity URL for observers.
- [ ] Scratch (no-repo) sessions: use the existing `chats.create({ useWorktree: false })` branch with a
  throwaway workspace `~/.mauscode/scratch/<id>`, no git remote required, artifacts downloadable via
  `/changeset`. **Promote-to-project** is the local inversion of Jules' "download the file outputs": reuse
  `sandbox-import.ts`'s adoption machinery to move a scratch session into a real project chat + worktree.
  Rationale for this reading (documented, reversible): `useWorktree:false` + `image-staging.ts` +
  `sandbox-import.ts` already give us ephemeral-workspace + adopt-later, so the honest port is "scratch →
  promote", not "serverless" (which contradicts the local-first thesis in `product-thesis.md`).
- [ ] `POST /v1/sessions` accepts the same `initialMessageParts` union `chats.create` already takes
  (`chats.ts:427-461` — text, `data-image`, `file-content`), so #34's deferred image work doesn't block it.
- Tests: auth matrix (no token / wrong token / query-string token rejected), scratch lifecycle,
  promote-to-project idempotency, changeset parity with the UI's own view (one builder, two consumers),
  cursor pagination on `?after`.
- Gate: API server must not add main-process work when disabled (assert no listener when the setting is off).
- Covers: #13, #14 (reinterpreted), enables #21, #16's re-entry.

### W9 — Scheduler + authorship · `add-scheduled-tasks` · depends: W1, W2, W5, W7

#8 scheduled tasks, #9 edit/pause/resume, #46 commit authoring.

- [ ] `autopilot/schedules.ts`: `schedules(id, projectId, name, promptTemplate, spec {kind: interval|daily
  |weekly|monthly, time, tz, dayOfWeek}, mode, authorshipOverride, pausedAt, lastRunAt, nextRunAt,
  budgetCap)`; a single `setTimeout` loop computing the next fire (no new dep — hand-rolled 5-field-ish
  parser with its own test table — recipe §11 is the same advice, and CI's Dependency-review job makes a new package an OpenSpec change of its own). Persist `nextRunAt` so restarts don't double-fire;
  clock-skew and DST tests mandatory.
- [ ] Fire = create a run at `priority: schedule` through W1's queue (never more than the global cap),
  template vars `{date} {project} {branch}`, then W5's evidence gate, then a **draft** PR.
  `schedule_runs` links to `runs` for a per-schedule history view.
- [ ] Edit / pause / resume **in place** (#9) via `schedules.{list,get,create,update,pause,resume,delete,
  runNow}`; row context menu in `automations-view.tsx` (272 L shell, already has cards + templates) and
  the detail view (916 L). "Run now" for testing a schedule is the QoL Jules didn't need to invent.
- [ ] Authorship (#46): replace the boolean `includeCoAuthoredBy` (which today only round-trips through
  `~/.claude/settings.json`, `routers/claude-settings.ts:121`, surfaced at
  `settings-tabs/agents-preferences-tab.tsx:237`) with `authorship: agent | coauthor-agent | coauthor-user |
  user`, **user-level default with per-project override**, applied in `git-operations.ts:141`'s commit path
  for *every* engine (native, legacy Claude, Codex, and the 5 print adapters) and every task type
  (scheduled, suggested, CI-fix, manual). Co-author trailer order is user-configurable
  (Jules' "You + Jules" vs "Jules + You"); `user` mode authors as the user and adds no trailer — that mode
  must still leave an auditable `run_events` record of agent authorship.
- Tests: scheduler table-driven (interval/daily/DST/missed-fire-while-asleep), pause/resume, run-now,
  four authorship modes × two engines, trailer-injection on amend/rebase paths.
- Gate: a 50-schedule backlog must fire with bounded concurrency and never outrank interactive (assert
  priority inversion in a test).
- Covers: #8, #9, #46.

### W10 — Memory + instructions (deep port, automatic, perf-positive) · `add-knowledge-layer` · depends: W1

#31 and #32 as the user escalated them: *"automatically we will deeply yet performance positive, copy and
port hermes-agent memory system and logic"*, confirmed for AGENTS.md too.

- [ ] **Spike first (required, cheap):** shallow-clone `NousResearch/hermes-agent`, extract its memory
  logic — capture triggers, categories, scoping, injection cadence, decay/gardening — into
  `.dump/app/research/2026-09-xx-hermes-memory-spike.md`, with a side-by-side against what the vendored
  runtime already has (`jcode-memory-types`: `MemoryGraph`, clusters/tags/edges, `MemoryScope
  project|global|all`, embedding search, the search→verify→inject→maintain pipeline, extraction reasons;
  `MEMORY_ARCHITECTURE.md`; note their own issue #491 — project-scoped writes silently no-op'ing without
  a per-call working dir, a bug class our port must not inherit). **Decision rule:** where Hermes and the
  vendored graph agree, keep the runtime's storage (already measured, already local) and port Hermes'
  *policy* on top; where they diverge, app-side first, propose a `maus.memory` protocol extension later —
  never an incompatible protocol fork (I-3).
- [ ] Capture automatically: at turn end, `runStructured` extraction of preferences / nudges / corrections /
  project conventions into `memory_entries(projectId, scope, kind, content, sourceRunId, confidence,
  pinned, supersedes, createdAt)` with dedupe-by-meaning and a hard per-project cap. **Never capture
  secrets** — reuse the token-redaction path and assert it in a test.
- [ ] Inject with a budget: bounded relevance-ranked injection (default ≤ 800 tokens, embedding-off
  fallback to recency+tag match) into the system prompt for same/similar tasks; log `injectedIds` on the
  run so the UI can show *why* something was remembered There is **no** prior app-side memory design in this
  repo: `.dump/app/plans/` holds only `mauscode-architecture-plan.md` and `.dump/app/audits/` is empty, so
  this wave's `design.md` is the design of record — its open questions (injection budget, capture
  categories, decay policy, per-project caps, UI explainability) get answered there, before code.
- [ ] Maintenance: gardening on idle only (merge/prune/decay), never concurrent with interactive work;
  respect the `MEMORY_BUDGET.md` guardrail culture.
- [ ] Instructions (#32): `src/main/lib/knowledge/instructions.ts` — resolve the hierarchy
  `~/.mauscode/AGENTS.md` → project `AGENTS.md` → nested `AGENTS.md` for monorepo subpackages, plus
  read-only legacy `CLAUDE.md` detection; port Hermes' context-loading rules; obey
  `docs/backend-porting-recipe.md` §"AGENTS.md/CLAUDE.md: per-project only, no global leakage" for the
  backend adapters. Surface a "context sources" popover: which files, sizes, staleness if modified
  mid-session. Reliability is the feature — Jules' own note was "*better at following your instructions in
  agents.md*", and **W0's `CLAUDE.md` correction is part of this wave's DoD** (a model can't follow docs
  that describe files that don't exist).
- [ ] UI: settings **Knowledge** tab (per-project memory on/off, "what was learned this session" list,
  edit/pin/delete), a memory chip in the chat header with the injection count, and a reviewer-visible
  "instructions in effect" panel.
- [ ] **Spike outcome (2026-09-13, read-only, `/tmp/hermes-agent` @ `de2d6a1`): memory is a lifecycle, not a
  store.** Port the control flow from `agent/memory_provider.py` (175 lines, read in full) +
  `agent/memory_manager.py` (842 lines): `is_available()` checks config/deps with **no network**;
  `system_prompt_block()` is static-only while recall goes through `prefetch()`; `queue_prefetch()` runs after a
  turn and is consumed by the *next* turn (⇒ zero added latency on the critical path, the literal mechanism behind
  "performance-positive"); `recall_status()` reports only the last prefetch; `sync_turn()` is non-blocking;
  `on_session_end()` fires at real boundaries and explicitly **never** per-turn; `on_session_switch(reset, rewound)`
  covers resume/branch/new/compression; `on_pre_compress` is versioned so a provider that durably checkpoints gets
  **fail-closed v2** semantics; `on_delegation` records child outcomes on the **parent** side (feeds W3);
  `on_memory_write` mirrors writes with `write_origin`/`session_id`/`tool_name` provenance; at most one external
  provider (their stated reason: tool-schema bloat and conflicting backends); hard timeouts (8 s prefetch, 5 s
  shutdown drain) on daemon threads; and a shared `is_trivial_prompt` gate — bare `yes|no|ok|thanks|continue|lgtm`
  and anything starting with `/` skip recall entirely, because "skipping recall saves a round-trip and keeps stale
  context from derailing one-word replies".
- [ ] Two things W10 must decide before coding, not during. **(a) who owns the store — answered 2026-09-13: hybrid.**
  The runtime may **propose** a memory, mausCode **stores** it, the user **accepts** it, and the engine's own store
  stays dark so nothing is written twice. Two options were refused rather than deferred. The app owning the store
  outright is the option this line used to recommend, and it would have left the vendored engine's graph as a second
  writer. The engine owning it is option B of `.dump/app/research/2026-09-13-hermes-memory-spike.md` §7, and it makes
  every injection decision depend on CLI output shapes while the one-provider rule stays unenforceable. Recorded in
  `.dump/global/decisions.md`; step 24 executes it. **(b) unattended write policy** — adopt hermes' fail-closed gate
  (`tools/memory_tool.py:132-134`): background and scheduled forks may `add`, never `replace`/`remove`, which is the
  same principle as §6's EvidenceBundle rule.
- [ ] Placement is a correctness requirement, not a style choice: hermes splits the prompt into a `stable` prefix
  (system + skill index) and a `volatile` tail containing memory + user profile (`context_breakdown.py:25`,
  `:64-74`, `:125-137`) *specifically* so upstream prompt caching survives per-turn recall, and counts memory as
  its own token budget category. Our `claude.ts` path concatenates once, so W10 must introduce the split **and** the
  test that the stable prefix is unchanged across turns when memory changes.
- [ ] Hook availability, measured: `compacted` is already translated
  (`src/main/lib/runtime/translate.ts:124`, covered by `translate.test.ts:128-131`), so a pre-compression
  checkpoint has a real event to hang on in this tree; the events that are **not** — `session_status`,
  `session_forked`, `wake_requested`, `background_progress`, swallowed by the fallthrough at
  `translate.ts:147-168` (22 cases) — are exactly the ones W1 restores, so W10's identity-switch and delegation hooks depend on
  W1 landing first (already reflected in this wave's `depends:`).
- Tests: capture/dedupe/supersede matrix, cap enforcement, redaction (secret must never land in
  `memory_entries`), injection determinism for a fixed corpus, hierarchy resolution (nested + legacy +
  missing-file cases), and cross-backend parity per recipe §0/§7 — whatever the memory path can actually do is what each backend's capability profile reports, with no silent widening on either engine.
- Gate: this is a *performance-positive* requirement, so it ships with numbers: per-turn added latency and
  prompt tokens measured at 1/5/25 sessions with memory on vs off; regression ⇒ shrink the injection budget,
  not the tests.
- Covers: #31, #32.

### W11 — Review + composer surfaces · `add-review-and-composer-surfaces` · depends: W5 (data), none else

#37 stacked diff (as improvement), #38 images in diff, #33 file selector, #43 panel width, #45 task modal,
#35 dynamic sample prompts, #49 UI polish.

- [ ] Diff (`agent-diff-view.tsx`, 2,178 L — extend, don't rewrite): file-list layout mode
  `stacked | tabbed` persisted (`atomWithWindowStorage`, like the existing `diffViewModeAtom`),
  default **stacked**; the change-set header renders W5's data — `[A]/[M]/[D]` + per-file ±counts +
  `Summary: N files changed, +X insertions, -Y deletions`; keep split/unified per file (already at `:75`),
  keep the memoized `FileDiffCard` and `LARGE_DIFF_LINE_THRESHOLD = 2000` virtualization, and don't touch
  the error boundary — it exists for a reason.
- [ ] Images in the diff: for image paths, render before/after from `file-contents.ts` + `image-viewer.tsx`
  (both exist) instead of binary noise, with dimensions/size delta, and honoring the same cap discipline so
  a 40 MB PNG can't be slurped into a row.
- [ ] #42's cheap subset comes along (copy file contents), full download-button deferred item stays
  deferred; #43: persisted width for the code/details panel, reusing `sub-chat-store.ts`'s split-ratio
  machinery (`splitRatios`, `MAX_SPLIT_PANES = 4`) rather than a new atom family.
- [ ] File selector (#33): composer chips pinning exact files; *narrowing* is easy (seed context, bias
  retrieval), and the part that makes it real is **enforcement** — the pinned set becomes a path allowlist
  for the run via W2's policy, with an explicit violation event in `run_events`.
- [ ] Task modal (#45): `NewTaskDialog` wrapping the existing new-chat flow (`new-chat-form.tsx`, 2,599 L —
  mount it in a `Dialog`, don't fork it) so tasks start without navigating away; "start another"
  keeps the current context; obey design-system §3.8 dialog rules.
- [ ] Sample prompts (#35, "genuinely useful, constantly updated over chat suggestions"):
  `src/main/lib/prompts/samples.ts` generates candidates from the user's own history
  (`session_search`-style, capped: last N chats, 1 cache build at idle) + repo signals (README/scripts,
  CI config, TODO density from W7's scan) + template success rates from `schedules`; ranked, deduped
  against done work, click-to-insert. Explicitly **not** a static list; no network call.
- [ ] Polish (#49, per `docs/design-system-baseline.md`): recessive non-urgent task icons, hover states
  within the `bg-foreground/5` wash scale, consistent padding/borders on system messages, and the
  `§10` punchlist dispositions already recorded. Every new row/pill/dialog here is level-1 conformance,
  audited the way §9 prescribes.
- Tests: layout-mode persistence, image-path cap, pin-enforcement (allow + deny), modal focus trap +
  draft isolation, sample generator determinism against a fixture history, and a visual/token conformance
  test (no `sky-500`, no `bg-foreground/[0.08]` — the baseline doc names the forbidden values, so assert them).
- Gate: diff view render cost unchanged at 200-file change sets (threshold already at `:77`; prove it).
- Covers: #37, #38, #33, #43, #45, #35, #49, #42 (partial).

### W12 — Web access as a research lane · `add-research-lane` · depends: W3

#51 — the user explicitly handed me the form: *"when you understand the codebase you'll know better"*.
The codebase already exposes `websearch`/`webfetch` in the runtime and renders them
(`agent-web-search-tool.tsx`, `agent-web-fetch-tool.tsx`) on the legacy path.

- **Decision:** don't add open-ended browsing to the main turn. Ship a **research lane**: a W3 child with
  `mode: ask` + web tools allowed, returning a *cited digest* to its parent so the parent's context stays
  clean (same mechanism as W3's tldr rule). Plus a per-workspace `webAccess: none | docs | any` policy,
  default `docs` = provider docs, MDN, package registries, project-declared doc hosts.
- [ ] Egress is reported, not implied: recipe §0 requires approvals/sandbox/egress/auth to be "reported in
  the capability manifest exactly as configured", so every backend profile (`src/main/lib/providers/<x>.ts`,
  recipe §7) gains `webEgress: none | docs | any` and the lane refuses to start on a backend that can't
  honor it — never a silent downgrade to "no web", never a silent "browse anything".
- [ ] Docs-cache invalidation is **new work; no prior design exists in this repo** (there is no
  `context-cache.md` and no `build/docs-index.ts` — `build/` is only DMG artwork). Proposed:
  `src/main/lib/knowledge/docs-cache.ts`, keyed on `(package, version)` parsed from the lockfile,
  invalidated by the existing git watcher when `bun.lock`/`package.json`/`pyproject.toml`/`Cargo.toml`
  change, so "what do the docs for X say" can't serve a stale version's content. First check whether the
  runtime's own `webfetch` already caches (it may; if so, this becomes a policy knob, not a module) —
  recipe §1's "research before code" applies, with findings in `.dump/app/research/`.
- Tests: domain policy allow/deny, digest citation shape, cache-key changes when a dependency version
  changes, zero-network path when `webAccess: none`.
- Gate: main-turn token usage must not grow (the lane is a child, so its tokens are attributed separately).
- Covers: #51.

### W13 — MCP management, our standard · `add-mcp-management` · depends: W2

#47 — *"we have or will have better ux +ui standards for mcp management"*. The engine is already
first-class (`mcp-config.ts` mirror, `mcp-auth.ts` OAuth, `cline-mcp`/`grok-mcp`/`qwen-mcp`/
`roo-mcp`/`openclaw-mcp` per-backend injection, `agents-mcp-tab.tsx` + `mcp/` subdir, and the native
`resolveNativeMcpSnapshot` path that reports `toolsUnknown` honestly).

- [ ] Settings → MCP (baseline §4.6 rules): per-server **kind** (stdio / http / sse) + enabled + auth
  status + tool allowlist + last-error, from one new store (next item). Today the effective state for the
  Claude path lives in `~/.claude/settings.json`, which `routers/claude-settings.ts` both **reads and
  writes** (`enabledPlugins`, `approvedPluginMcpServers`, `includeCoAuthoredBy`, 5 s caches + invalidation
  hooks). That is a third-party store: it becomes an import source and an output mirror, never our truth.
- [ ] Migrate the effective state into a `mcp_servers` table + `~/.mauscode/mcp/config.json` overlay, with
  **read-only import** from `~/.claude/settings.json`, `~/.claude.json`, project `.mcp.json`, and each
  backend's native file. Follow recipe §11 verbatim: "prefer the CLI's native config; dynamic injection only
  when the protocol supports it race-free; fingerprint on resolved config so changes respawn sessions" —
  which is exactly why `resolveNativeMcpSnapshot` reports `toolsUnknown` rather than pretending, and why the
  `add-native-mcp-passthrough` Phase-1 mirror stays the write path. One app-side truth, per-backend
  materializers, and no secret values in any config file (I-5: refs into `safeStorage` only).
- [ ] Service catalog (Jules' Linear/Supabase/Neon/Context7/Tinybird/Stitch class of integrations) as a
  curated, reviewable list of stdio/http definitions — install-time consent naming every binary/URL it
  touches, per the config-plan's §3.6 posture; "request a server" writes a local record (and later the
  control plane). Deferred #48's allowlist/security-audit work is explicitly *not* in this wave.
- Tests: precedence order (per-project > global > legacy read-only), OAuth refresh + needs-auth surfacing,
  per-project isolation (the same test `add-native-mcp-passthrough` still owes: "two projects, disjoint
  servers, no leakage" — do it once here and reuse it), and **the 6 `*-mcp.ts` modules converge on one
  `McpTarget` interface** so a 10th provider is one small profile + one materializer call — the shape
  recipe §2/§7 already prescribes for a new backend (scaffold, capability profile, probe, mock, tests).
- Covers: #47 (own UX).

### W14 — Remote profile: environment machinery (optional, off by default) · `add-remote-env-profile` · depends: placements

#26–#30, which the user scoped to *"for like remote work, /make optional (i'm still trying to get to a
stable state"*. Nothing here changes local defaults. This wave is **parked behind P5/P6/P7 of
`mauscode-architecture-plan.md`** (SSH / Docker+Daytona / device-registry) and is scheduled, not
un-scheduled.

- [ ] Design now, build with placements: `environment.ts` + `environmentHttp.ts` contracts (843 L, already
  ported — F1) describe exactly this; map our `SetupScript`, `EnvFileRef`, `ToolchainPin`, `DiskBudget` onto
  `EnvironmentSpec` via the contract seam, **without** reusing their names in user-facing copy.
- [ ] `env_setup_scripts(projectId, engine?, content, order, timeoutMs)` — honored on **all** engines,
  including per-backend setup hooks, and including a scratch session's first boot — the asymmetry is real and undocumented: there is **no** prior
  design for this in the repo (`.dump/app/plans/` has only the architecture plan, `docs/` has protocol, the
  recipe, the design baseline, `ci-gotchas.md` and `daytona-vnc-from-scratch.md`), so the priors are
  `competitive-capabilities.md` C1/C2 and P5–P7 of `mauscode-architecture-plan.md`, and this wave writes
  the design before it writes code.
- [ ] Snapshots are runtime-scoped: reuse the daemon's own `restart_snapshot.rs` / plan-restore mechanism
  rather than inventing a parallel one; `maus.checkpoint` (already reserved in `docs/protocol.md` §3) is
  the protocol home for the atomic transcript+tree snapshot. Jules' env snapshot ⇒ our snapshot *policy*,
  not a new storage layer.
- [ ] Runtime manifests (`~/.mauscode/runtime-manifests/<name>.json`: `engines[]`, `toolchains[]`,
  `setupScript`, `files[]`, `envKeys[]`, `preview`) — new, and its two hard questions get answered in the wave's `design.md` first: **hard reject on manifest+toolchain mismatch** (not prompt-override), and a
  per-session `effectiveRuntimeHash` recorded so mid-session manifest changes are detectable.
  Pinning stays *declarative* (manifest names toolchains; it doesn't reinstall them).
- [ ] Toolchain pinning + Bun: only for placements where we own the image. `bunfig.toml`/`bun.lock`
  detection is already what this repo runs on (bun is the package manager), so the local path needs nothing;
  don't fake "out of the box runtimes" for a user's laptop.
- [ ] Disk budget (#30): `diskBudgetBytes` per workspace + `ENOSPC`-as-first-class-error surfaced as a run
  failure with remediation ("prune scratch, raise budget"), never a silent stall. This part *is* worth
  doing early even for local, since our scratch sessions (W8) create the pressure — split it into W8's DoD
  if the placement work slips.
- Covers: #25 (env vars, deferred → lands here), #26, #27, #28, #29, #30.

## 5. Sequence & dependency graph

```
W0 (ground truth) ─┬─ W1 (run integrity) ─┬─ W2 (permissions) ─┬─ W4 (critics) ─────────────┐
                   │                      │                    ├─ W5 (changeset/export/PR) ─┼─ W6 (CI fixer + PR state)
                   │                      │                    │                            ├─ W9 (scheduler + authorship)
                   │                      └─ W3 (orchestration/subchats) ── W12 (research lane)
                   ├─ W8 (sessions API + scratch)                    │
                   └─ W11 (diff/composer/polish)   W7 (suggestions/inbox) ──┘
W10 (memory+instructions) — after W1, parallel to W3–W7    W13 (MCP) — after W2    W14 (remote env) — parked behind P5–P7
```

Recommended order: **W0 → W1 → W2 → W5 → W3 → W4 → W9 → W6 → W7 → W11 → W10 → W8 → W12 → W13 → W14.**
(W5 before W3/W4 because critics and orchestration both need evidence + change-set truth; W11 late because
it's pure surface work once the data exists; W14 last by design.)

Milestones: **M1** = W0–W2 (runs can't lie, nothing runs unattended without a policy); **M2** = W3–W5
(sub-chats + critics + evidence/PR); **M3** = W6–W9 (unattended value: CI fixing, proactive findings,
schedules, authorship); **M4** = W10–W13 (knowledge, surfaces, API, MCP); **M5** = W14.

## 6. Cross-cutting non-negotiables

- **Perf (`CONTRIBUTING.md`'s one hard rule + I-6 in `.dump/app/second-brain.md`):** every wave ships a
  benchmark record in `.dump/app/benchmarks/` plus a `benchmarks/` entry; matrix at 1/5/10/25/50 sessions.
  The P1 record is the standard to beat, not to match: "No numbers below are performance claims; the
  benchmark gate stays CLOSED."
- **Cross-backend parity (recipe §0/§7):** any new `lib/` interface (runs, changeset, permissions, memory,
  MCP, web egress) is implemented for the native runtime **and** at least one compatibility agent in the
  same wave, tested against both, reported honestly in each capability profile. This is why W1 keeps
  `claude.ts`/`codex.ts` in scope — their `activeSessions`/`activeStreams` maps are the same bug surface.
- **Chunk dialect is closed (recipe §4):** new state travels on typed tRPC subscriptions, never on new
  `UIMessageChunk` kinds; `Bash`/`Edit`/`WebSearch`/`Thinking`/`mcp__<server>__<tool>` naming stays as is.
- **No new dependencies:** scheduler parsing, cron-ish specs, sample ranking, label polling — hand-rolled
  and tested. CI enforces the cost (`Dependency review` job + `audit-ratchet.mjs` against
  `.github/ci-baselines/audit-critical.txt`), so an exception is its own OpenSpec change.
- **Tests:** 65 test files exist today (23 in `src/shared/contracts`, 5 in `lib/runtime`, the rest per
  `*-print` backend + `codex-app-server` + `terminal`) — `current-system-map.md` §2's "No test files
  anywhere in the repo; no test runner configured" is the stale sentence W0 corrects. New main-process tests
  are colocated (`node:test`/`node:assert/strict` or vitest per `vitest.config.ts`) and always against a
  mock, "because binaries never exist in CI/sandbox" (recipe §0) — the established fixtures are
  `src/main/lib/*-print/test/fixtures/*.mjs`, `codex-app-server/test/fixtures/*-mock-peer.ts`,
  `packages/runtime-client/test/mock-harness.ts`. `vitest.config.ts` is `environment: "node"` and says its
  tests "cover main-process logic, not the renderer", so renderer work is verified by typecheck +
  conformance greps + a manual run, and every wave states which one it used.
- **Edge cases:** each wave runs the applicable rows of recipe §12's catalog (abort before/during/after a
  turn, supersede, double `error`/`finish` emit, stale resume ids, temp-file cleanup, port conflicts,
  missing binary, Windows paths, asar unpacking, clock skew, model-id drift, `dispose()` idempotency).
  Listed as tasks, not assumed.
- **Docs, same change:** `CLAUDE.md`, `openspec/project.md` when conventions shift, `.dump/app/second-brain.md`
  for facts, and a dated record in `.dump/app/{decisions,plans,research,benchmarks}/`. `.dump` is curated
  durable memory — "not a transcript, not a scratchpad, not a trash folder", one fact in exactly one file
  (`.dump/app/README.md`).
- **Provenance & licensing:** JCode stays MIT-attributed with every runtime patch recorded in
  `runtime/jcode`'s `UPSTREAM.md` patch list (precedent set by `add-runtime-permissions`); T3-sourced files
  keep MIT headers + `@211618f` provenance (`src/shared/contracts/README.md` is the template); 1Code
  Apache-2.0 attribution untouched. Recipe §0 governs all of it: upstream code is "ported verbatim +
  attribution header, **or not at all**", everything else is an adapter marked NOT verbatim — so Hermes /
  Jules / T3 *behaviors* land as mausCode adapters and nothing scraped from a closed-source product enters
  the app tree.
- **DB:** Drizzle only, `bun run db:generate`, never hand-edit `drizzle/` (that part of `CLAUDE.md` is
  accurate). Tests never touch real user data; the standing repo convention against writing `~/.21st/` and
  the user's `~/.mauscode/worktrees` from test code stays in force.
- **Labels:** the trigger label defaults to `mauscode`, configurable per project; there is no existing label
  automation in this repo to collide with, so this is a naming choice, not a constraint.

### 6.1 Lint campaign — closed 2026-09-13 (measured, not asserted)

The standing order was "fix ALL findings, tests included, no exemptions". Final state, all of it
re-measured with `npx -y @biomejs/biome@2.5.13 check . --max-diagnostics=none`:

| step | findings | what went |
| --- | --- | --- |
| baseline at `6f4d818` | **135** | the inherited debt of this branch (the handoff's ~1,400 figure described `arena/01a08de4-mauscode`, never pushed, so it is not this tree's history) |
| `6d616ea` | **103 → 79** | 14 `noControlCharactersInRegex`, 14 `useIterableCallbackReturn`, 3 `noUnusedImports`, 2 stale suppressions, then all 25 remaining `noArrayIndexKey` (new `src/renderer/lib/react-keys.ts`) |
| `34c7bb3` | **55** | 4 editable-command-row keys (`src/renderer/lib/command-rows.ts`), 10 `noLabelWithoutControl`, 8 `noSvgWithoutTitle`, 1 `noDescendingSpecificity` |
| `9734578` | **0** | 55 `noExplicitAny`, replaced by real types — no suppression added anywhere |
| `c71c270` | gate | every rule in `biome.json` that was pinned to `"warn"` is now `"error"`, and the stale per-file `useSemanticElements` downgrade on `agents-sidebar.tsx` is deleted |

Rules that governed the work, worth keeping for the rest of the program:

- Fix the root cause; never add `biome-ignore`. Deleting a suppression or an unnecessary cast counts
  as progress; narrowing a *file scope* for non-DOM packaging artifacts (`out/`, `resources/bin`,
  `build/`, `runtime/jcode`) is allowed, narrowing a *rule* is not.
- Stable identities beat content hashes for editable rows: a keystroke-derived key remounts the
  `<Input>` and drops the caret. Persistence keeps its old shape (`string[]`) and dirty-checking
  compares texts, so ids never read as unsaved edits.
- One a11y rule's fix can create another (`role="group"` → `useSemanticElements`, `<span onClick>`
  → `useKeyWithClickEvents`). Re-measure the whole repo, not the file you touched.
- `noLabelWithoutControl` genuinely cannot see a Radix `Checkbox` (`role="checkbox"` on a
  `<button>`), and `label[for]` cannot activate a non-labelable element: `aria-label` on the control
  is the fix, not `htmlFor`.

By-product worth keeping in mind for later waves: seven casts were **proven redundant** by `tsc`
and deleted instead of retyped — six `super({ … } as any)` in the vendored
`src/shared/contracts/{project,filesystem}.ts` (t3code carries the same five at `:137,168,190,263,300`;
a good upstream patch, and casts are erased so our emitted JS is unchanged) and one on a hermes
`doStream` call. `src/main/lib/claude/transform.ts` now translates `ClaudeStreamMessage` (the SDK
union widened with `parent_tool_use_id`) instead of `any` — the typed-stream design this plan
recorded in §2/P2 is now actually applied, which is what makes wave W1's `RunState`/`BackgroundProgress`
carry-over safe to build on.

Gates at every step: root `tsc --noEmit` = 0, `npx vitest run` = 54 files / 618 tests,
`node scripts/ci/lint-changed.mjs` = 0 over 954 files, and `packages/runtime-client`'s new
`tsc -p tsconfig.test.json` = 0 with its 43 `node --test` cases passing. Two things this sandbox
could not check, stated plainly: the renderer bundle (`electron-vite build` OOMs at ~1.9 GB — a
sandbox limit, not a repo defect) and the two bun-based ratchet scripts (no `bun` binary here; they
run in CI, where `oven-sh/setup-bun@v2` installs it).

## 7. Deferred / rejected (why, and what reopens them)

| Item | Verdict | Re-entry trigger |
|---|---|---|
| #16 activity log + `createTime` cursor | defer | W8's `/activities?after=` is the hook; reopen on cross-device sync or a third-party API consumer |
| #21 CLI apply-patch-locally | defer | #13 ships → `git apply` of `GET /changeset.patch` is the whole feature; reopen if a `mauscode` CLI returns |
| #25 env vars | defer → W14 | with the remote profile |
| #34 image upload | defer | already half-present (`chats.create` `data-image`, `image-staging.ts`); reopen for follow-up-message parity + caps |
| #39 Playwright web-app verification | defer | `previewAutomation.ts` (951 L, ported, unused) + W1's `side_pane_images` plumbing make it cheap; reopen when previews are runtime-scoped |
| #42 code-view copy/download | defer (partial done in W11) | when the code-view pane gets its own toolbar pass |
| #44 pause/resume/delete + copy task URL | defer | needs W1's `RunState` + W3's tree to define "pause" honestly (a cancel/rewind pair vs a soft interrupt) |
| #48 MCP allowlist + security audit | defer | before any hosted/relay surface ships |
| #53 formal state machine + narrow/mobile | defer | W1 fixes the lying-status *bugs*; the rewrite + `use-mobile` layout pass reopen together |
| #12 Render/deploy webhooks · #17 ChatOps/Linear/Jira/CI · #18 plan limits/quota errors · #19–20 CLI+TUI · #22 CLI diff viewer · #36 model tiers · #54 pirate persona | **rejected** | rejected on purpose: local-first BYOK thesis (`product-thesis.md`), no hosted control plane, no CLI product |

## 8. Risks

- **R1 — W2's Rust dependency.** `add-runtime-permissions` needs a toolchain this environment lacks, and
  unattended waves hang off it. Mitigation: Track B (app-side read-only enforcement) keeps W4/W7 shippable
  with `deny-by-default` + no auto-push; anything that pushes to a remote requires Track A green.
- **R2 — Perf thesis vs 30 features.** Every autonomy feature wants to spawn sessions. Mitigation: one
  queue (W1), one priority ladder, one concurrency cap; each wave's gate is numeric and recorded.
- **R3 — Two sources of truth.** W1 could collide with the runtime's own ambient scheduler
  (`docs/AMBIENT_MODE.md`) and W5/W13 with the pending config/permission migrations. Mitigation: W1/W7
  explicitly *do not* enable the daemon's ambient runner (deferred consolidation is recorded in W7); the
  config and permission migrations are prerequisites listed inside W13 and W2, not left implicit.
- **R4 — T3 contracts as dead weight.** Adopt-per-use (W0) prevents a second DTO universe without
  pretending we're a T3 app; `add-fork-harvest-transplants` Phase 5 (T3 server) stays held — this plan
  ports **no** T3 server, only what we already vendored.
- **R5 — File size gravity.** `active-chat.tsx` (8,527 L), `agents-sidebar.tsx` (3,380 L), `claude.ts`
  (3,197 L), `new-chat-form.tsx` (2,599 L), `chats.ts` (2,326 L), `agent-diff-view.tsx` (2,178 L),
  `sub-chat-selector.tsx` (1,035 L), `agents-content.tsx` (990 L) are where most UI waves must land, and
  `current-system-map.md` §18 says the opposite of what an eager implementer wants: renderer `features/*` are
  "KEEP as reference implementation … no redesign before the vertical slice works", and "never rewrite a
  stable module for cleanliness". Mitigation: waves add sibling modules (`runs/`, `changeset/`,
  `knowledge/`, `critique/`) and touch those files only to consume; a wave that would grow `active-chat.tsx`
  past ~+300 L must propose the extraction in its own `design.md` first.
- **R6 — Some gates can't be run here.** `bun`, `rustc` and `tsgo` are all absent from this sandbox (the P1
  record says the same in terms: "Repo-blessed `ts:check` (tsgo) cannot run: binary not installed in this
  env", "no bun, no Electron binary, no display"), the renderer bundle fails pre-existing on
  `Missing "./ayu-light" specifier in "@shikijs/themes"` for both HEAD and baseline builds, and typecheck is
  a ratchet against `.github/ci-baselines/typecheck.txt`, not a green check. Mitigation: every wave's DoD
  names the gate *and* who can run it; CI-only items stay open in `tasks.md` as explicit handoffs — the way
  `add-native-local-execution` left its gate CLOSED with a record instead of claiming a pass.
- **R7 — Unattended side effects.** Auto-push, auto-PR, auto-fix loops on a user's real repos.
  Mitigation: draft PRs by default, explicit scope guard (only PRs we authored), W2's review queue, every
  automated action recorded in `run_events` with the authorship mode applied (W9), and a single global
  "autopilot" kill switch in settings.
- **R8 — Prompt-cache damage from memory injection (W10).** Placing per-turn recall inside the string we already
  send as stable system context silently costs every project with history: no test fails, the bill and the latency
  just get worse. Mitigation: W10 ships the `stable`/`volatile` split and a test asserting the stable prefix is
  byte-identical across turns when memory changes (`research/2026-09-13-hermes-memory-spike.md` §3, §9.1).
- **R9 — A knowledge store we cannot repair (W10).** `memory_entries` with no cap and no recovery path turns a
  support burden into a data-loss incident; hermes carries `maintenance`/`repair`/`portability`/`readpool` modules
  for exactly this. Mitigation: ship the per-project entry cap with visible eviction, plus an integrity/recovery
  step in the same wave — or W10 does not ship. Spike §5 and §9.2.

## 9. Decisions I made where you delegated (flagged, reversible)

1. **#14 repoless → scratch sessions + promote-to-project** (not "serverless"), because `useWorktree:
   false` + `sandbox-import.ts` already provide the local semantics and the thesis rejects hosted
   dependence. W8.
2. **#24 repo inference → not a CLI**: it becomes derived repo/PR/CI state in the sidebar + `chats.create`
   auto-detect, with the requested deep t3code spike as the design input (W6). Your answer said "yes both",
   so both read-only detection *and* the auto-PR lifecycle are in scope.
3. **#51 web → a research lane + domain policy**, and it carries the version-bump cache-invalidation fix
   that would otherwise leak stale docs into every session (W12).
4. **#50 → stuck-session half only**: run integrity + status truth, no queue/backpressure rewrite, no
   state-machine rewrite, no mobile pass (W1; #53 stays deferred).
5. **#47 → MCP stays ours**: engine-side `mcp-config.ts` + one settings panel per the design-system
   baseline, rather than Jules' paste-a-key panel (W13).
6. **#37/#38 → improvement pass on the existing diff viewer** — it already has split/unified, a 2,000-line
   threshold, an error boundary and copy-path menus; we add stacked/tabbed, the change-set summary, and image
   rendering rather than a second viewer (W11).

## 10. Start here

1. `bun install --frozen-lockfile && bun run build:runtime-client` — the `file:` workspace dep resolves to
   `packages/runtime-client/dist`, so skipping the build makes typecheck lie to you.
2. Open `update-instructions-and-contract-seam` (W0) as an OpenSpec change and get it approved — it's a
   half-day and it's the instruction layer every later wave (and every agent) reads.
3. ~~Run the two spikes~~ **Done 2026-09-13.** Findings live in
   `.dump/app/research/2026-09-13-t3code-pr-state-spike.md` (PR state: vendored-but-dead link model, refresh
   policy, `dedupeChecks` vendor candidate) and
   `.dump/app/research/2026-09-13-hermes-memory-spike.md` (memory as a seven-hook provider lifecycle, prompt
   placement, unattended write gate). W5, W6 and W10 above already carry their outcomes.
4. Read `.dump/app/plans/release-parity-v0.0.75-0.0.84-plan.md` — the recreated 1Code v0.0.75→v0.0.84 parity
   program — and §11 below. The three programs are one sequence now; the parity plan lists what is already fixed on
   this branch so nobody re-does it.


## 11. One program: the Jules waves, the 1Code parity phases, and the inherited to-do list

The user's instruction was to fold three things together rather than keep three lists: this plan's waves
(W0–W14), the recreated release-parity program (`plans/release-parity-v0.0.75-0.0.84-plan.md`, phases P0–P8 from 47
items in 1Code's own notes for v0.0.75–v0.0.84), and the unfinished task list of the session that preceded this one
(the "resumption" work: the lint campaign tail, the app build, tests/packaging, then the JCode engine port — under
the standing priority instruction *"finish the app build FIRST … then the JCode engine port"*).

### 11.1 Measured state of the resumption list, 2026-09-13

This branch is a single commit (`1a37e0b`) on top of `9f1bc76 Release v0.0.72`; the remote has only `main`, and
PR #2 is open with three commits touching three files (`.github/ci-baselines/typecheck.txt`,
`agent-task-tool.tsx`, `git-activity-badges.tsx` — the import-sort fix plus the empty baseline). The previous
session's later work (its "`any`-sweep batches") was never pushed, so it does not exist here and cannot be
resumed as a diff: it has to be redone, which is why this section records a **fresh measurement** instead of its
stale inventory.

| Task as inherited | Measured today | Remaining work |
| --- | --- | --- |
| "2 tsc errors + ~148 Biome warnings" | `npx @biomejs/biome@2.5.13 check . --max-diagnostics=none` → **0 errors, 135 warnings** — closed 2026-09-13 at 0 findings, all rules at `"error"`; see §6.1 | 55 `noExplicitAny`, 31 `noArrayIndexKey`, 14 `useIterableCallbackReturn`, 14 `noControlCharactersInRegex`, 3 `noUnusedImports`, 1 `noDescendingSpecificity` (+ ~18 in rules the grep above does not name, e.g. a11y). `tsc` itself cannot run here: no `node_modules`. |
| "fix ALL findings, tests included, no exemptions" (binding) | `biome.json:43,46` mark the any/control-char rules `"warn"`, which is why a clean exit coexists with 135 findings | DONE: all groups driven to 0 and every `"warn"` severity in `biome.json` flipped to `"error"` (`6f4d818`→`c71c270`); see §6.1. Ordering that worked last time and still applies: mechanical first (`noUnusedImports`, `noArrayIndexKey`), then `useIterableCallbackReturn`/`noControlCharactersInRegex`, then `any` removal file by file with `tsc` after each. |
| "`any`-removal batches A–D done" | **Only partly in this tree.** 25 files still carry `: any`/`as any`: `qwen-print/session.test.ts` (6), `shared/contracts/project.ts` (5), `opencode/session.test.ts` (5), `runtime-client/test/mock-harness.ts` (5), `hermes/acp-chat.test.ts` (4), `grok-print/session.test.ts` (4), `runtime-client/test/client.test.ts` (4), `roo-print/session.test.ts` (3), `projects-rail.tsx` (2), and 1–2 each in 16 more. Parts of the sweep *are* committed: `cline-print/{session,auth-config,mcp-config}.ts`, `mcp-auth.ts`, `hermes/policy.ts`, `ollama/detector.ts` measure **0** findings | Finish the sweep on the 25 files above; the already-clean ones show the shape of the fix, so imitate them instead of re-deriving it. |
| "streamdown `Components` breaks typecheck (P0-1)" | **Already fixed here** — `src/renderer/components/chat-markdown-renderer.tsx:12-15` | nothing; do not re-apply |
| "hermes resume-failure test (P0-2)" | **Already fixed** — it is the tip commit | nothing |
| "changelog anchor double-`#` (P1-6)" | **Still broken** — `src/renderer/lib/hooks/use-just-updated.ts:53-54` interpolates `#${version}` where `version` already begins with `#` | one-line fix, ready to apply |
| "two Codex default models (P1-5)" | **Still divergent** — `routers/codex.ts:146` `"gpt-5.5"` vs `renderer/features/agents/lib/acp-chat-transport.ts:41` `"gpt-5.5/high"` | one shared constant in `src/shared/` |
| "app build, then packaging" | measured 2026-09-14 by step 03 on `arena/01a09fc7-mauscode`: install 1169 packages in 5.94 s, main 2,869.39 kB, preload 12.48 kB, all nine gate commands green, renderer OOMs on the 3.8 GB sandbox under both the 1.91 GB default heap and the 4 GB CI flag, binary downloads and packaging blocked by the proxy, launch test not runnable without a display stack. Full record with evidence: `.dump/app/benchmarks/2026-09-13-build-gate.md` | the renderer build, binary downloads, packaging and the launch test still need a machine where the release-asset host and a display are reachable; the CI jobs on the step 03 PR cover build and package, the launch check stays open until a machine with a display runs it |
| "then the JCode engine port" | `runtime/jcode/` is vendored at v0.84.0 (`ce4e789`); `--parallel` was redirected to W3 and `--extensions`/quota/model-tier items were answered NO in the triage | engine-side work stays gated by W0's protocol mirror and W2's permission floor; nothing in this program requires new `maus.*` verbs |

Three items the handoff asserted are **not true on this branch** and must not be repeated in later reasoning: the
"`ClaudeStreamMessage`/`ClaudeContentBlock` typed stream" design was never applied (`src/main/lib/claude/transform.ts`
has neither symbol), the "69 anys across 23 files" inventory is stale (measured above), and "no PR status consumer
exists" is wrong (`getPrStatus` has three call sites; see §1 F4's corrected text).

### 11.2 The unified sequence

Phases are interleaved, not appended: a wave and a parity item that touch the same file ship together, because the
lint rule ("zero new findings per commit") makes batching mandatory.

| Order | Work | Why here |
| --- | --- | --- |
| 1 | **W0** + P0-4 + `ts:check` decision | instructions/gates first; everything else is measured against them |
| 2 | **Build gate** (R-series): install, `build:runtime-client`, `build`, then `typecheck`/`lint`/`test` at zero new findings | "finish the app build FIRST" — and every later claim needs a runnable gate |
| 3 | **P1-6, P1-5, P4-shortcuts** (changelog anchor, one Codex constant, the 19 inert shortcut ids) | three verified-broken, small, user-visible fixes; unblocks nothing else but earns immediate trust |
| 4 | **W1** + `any` batches 1–2 (harness/transform typing rides along) | run integrity is the precondition for all unattended work |
| 5 | **W2** | permission floor before anything self-driving |
| 6 | **P1-1/P1-2/P1-3 + P2** (SDK 0.3 line, CLI pin, Codex binary, three registry tools, adaptive thinking/effort) | one dependency commit; recipe §4's closed dialect re-checked in the same change |
| 7 | **W5** + P6 (persisted PR snapshot, refresh policy, `dedupeChecks`, `BranchSwitcher`, PR widget) | the t3code spike lives here |
| 8 | **P3, P5** (sub-chat optimistic create, panes, tab groups, fork-while-streaming) | hourly-touch surface; needs W1's run state to be honest |
| 9 | **W3, W4, W9** (threadmaxx, critics, scheduler) | orchestration after the floor and the changeset |
| 10 | **W6, W7** (CI fixer, suggestions/inbox) | automation on top of real PR state |
| 11 | **W10** (memory) + **W11** (review/composer) | memory needs W1's events; UI polish needs the design-system baseline pass |
| 12 | **W8, W12, W13** | sessions API, research lane, MCP management |
| 13 | **P8 + packaging + `package:mac` artifact** | release mechanics and the downloadable app last, once gates are green |
| 14 | **W14** | still parked behind the remote/placement decisions |

`any`-batch work and the remaining warning groups are spread across every row, not hoisted to one end (a big-bang
lint commit would collide with all of the above).

### 11.3 Decisions now open to the user (four, and only four)

1. **SDK line** — `0.3.270` (recommended) vs the release note's literal `0.2.63`. Blocks row 6.
2. **Drag and drop** — native HTML5 (recommended) vs `@dnd-kit`. Blocks row 8.
3. **Codex default** — keep `gpt-5.5` (recommended, record the deviation) vs the note's `gpt-5.4`. Blocks row 3.
4. **Memory store owner** — app-side table + provider (recommended) vs reading the vendored engine's memory.
   Blocks row 11.

Everything else in this plan was decided earlier and is recorded in `decisions/2026-09-12-jules-feature-triage.md`
(54 verdicts) or in §9. Nothing here widens approvals, sandboxing or egress, and nothing here adds a
`bypassPermissions` path.
