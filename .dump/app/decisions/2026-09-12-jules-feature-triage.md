# Decision: Jules changelog feature triage (port / skip / defer)

Date: 2026-09-12. Method: full Jules changelog (2025-05-19 → 2026-03-09) decomposed into 54 discrete
portable features; each put to the user as its own question with `yes` / `no` / `defer for
contemplation` plus free text, over 5 rounds including a clarification round. Custom answers are
reproduced verbatim below because several are requirements, not opinions.

Consumed by `../plans/2026-09-12-jules-port-plan.md`. This file is the record of *what was asked and
answered*; the plan is the record of *what will be built*.

## Verdicts

| # | Jules feature (changelog date) | Verdict | Wave | Note |
|---|---|---|---|---|
| 1 | Auto-Fixing CI Failures (2026-02-19) | **yes** | W6 | watch checks → ingest failure log → fix → push → resubmit, bounded loop |
| 2 | Planning Critic for auto-approved plans (2026-01-26) | **yes** | W4 | second agent critiques/refines unattended plans before execution |
| 3 | Critic Agent, adversarial on code (2025-08-08) | **yes** | W4 | pre-completion review of the patch; feedback applied in-loop |
| 4 | Improved Critic transparency (2025-09-03) | **yes** | W4 | critic reasoning streamed live into the activity feed |
| 5 | Interactive Plan (2025-08-08) | **yes** | W4 | clarifying-question brainstorm before execution; opt-in per task |
| 6 | Suggested Tasks: TODO mining + plan + approve (2025-12-10) | **yes** | W7 | incremental scanner, per-project toggle |
| 7 | Suggested Tasks: performance findings (2026-01-26) | **yes** | W7 | same surface, perf detector class |
| 8 | Scheduled Tasks (2025-12-10) | **yes** | W9 | local scheduler → session → PR; reuses the vestigial `automations/` UI |
| 9 | Update Scheduled Tasks: edit/pause/resume (2026-01-26) | **yes** | W9 | in-place mutation, no delete-and-recreate |
| 10 | GitHub issue label starts a task (2025-06-26) | **yes, as abstract inbox + GitHub adapter** | W7 | user: "Both" — generic promotable inbox item + `mauscode` label adapter on top |
| 11 | Acts on PR feedback, 👀 + Reactive Mode (2025-09-23) | **yes** | W6 | read comments, react, push commit, reply; @-mention-only mode |
| 12 | Render deployment auto-fixes (2025-12-10) | **no** | — | third-party deploy webhooks excluded; CI Fixer (1) covers Actions |
| 13 | REST API: create/list sessions (2025-10-03) | **yes** | W8 | local loopback control surface, token-gated, opt-in |
| 14 | Repoless sessions (UI 2025-11-20, API 2026-01-26) | **yes, reinterpreted** | W8 | user deferred the shape to the code read; see custom answers → scratch workspace + promote-to-project |
| 15 | Full file outputs as parsable change set (2026-01-26) | **yes** | W5 | `[A]/[M]/[D]` + per-file ±counts + totals + `.patch` download |
| 16 | Immutable activity log + `createTime` cursor (2026-01-26) | **defer** | — | re-entry trigger: cross-device sync or third-party consumers of the API |
| 17 | Slack ChatOps / Linear / Jira / CI-trigger integrations | **no** | — | hosted-integration posture explicitly rejected; local-first |
| 18 | API auth + plan limits + concurrency caps (2025-05-30) | **no** | — | no metered plans; W1 owns concurrency for a different reason (fairness) |
| 19 | CLI: `remote new/list`, scriptable, `help` (2025-10-02) | **no** | — | no CLI in this product; W1 launcher story stays as-is |
| 20 | CLI TUI dashboard (2025-10-02) | **no** | — | same |
| 21 | CLI: apply session patch locally (2025-10-02) | **defer** | — | re-entry: W8 shipping makes `GET /changeset` trivially `git apply`-able |
| 22 | CLI side-by-side diff + auto-approval/timeout fixes (2025-11-10) | **no** (as CLI) | W11 | split/unified + stacked already exist in-app; extended in W11 instead |
| 23 | CLI `--parallel` (2025-11-10) | **yes, escalated** | W3 | became "threadmaxx" sub-chat orchestration — see custom answers |
| 24 | CLI repository inference (2025-11-10) | **yes, redirected** | W6 | became sidebar repo/PR/CI state detection + auto-PR, t3code-nightly grade — see custom answers |
| 25 | Repo-level environment variables (2025-10-01) | **defer** | — | re-entry: with the remote profile (26–30) |
| 26 | Environment setup scripts (2025-08-05) | **scoped** | W13 | "for like remote work, /make optional (i'm still trying to get to a stable state" |
| 27 | Environment snapshots (2025-08-05) | **scoped** | W13 | same |
| 28 | Modernized base env + toolchain pinning (2025-06-18) | **scoped** | W13 | same |
| 29 | Bun + multi-runtime out of the box (2025-07-18) | **scoped** | W13 | same |
| 30 | VM/disk budget, disk-full handling (2025-08-15) | **scoped** | W13 | same — all five live behind the remote/placement profile, off by default |
| 31 | Memory: learns preferences/nudges/corrections (2025-09-30) | **yes, escalated** | W10 | "automatically we will deeply yet performance positive, copy and port hermes-agent memory system and logic" |
| 32 | AGENTS.md instruction reliability (2025-06-20) | **yes, escalated** | W10 | "same" → confirmed as the same treatment as memory (deep port of hermes-agent context-loading logic) |
| 33 | File selector to pin exact files (2025-09-29) | **yes** | W11 | pin = context narrowing *and* enforced path allowlist |
| 34 | Image upload at task creation (2025-09-09) | **defer** | — | re-entry: parity check only; `chats.create` already accepts `data-image` parts and `image-staging.ts` exists |
| 35 | Sample prompts (2025-09-02) | **yes, dynamic** | W11 | "yes genuinely useul ones constantly updated over chat suggestions" — generated, not static |
| 36 | Model tiers / default-model rollout (2025-11-19 → 2026-03-09) | **no** | — | BYOK + per-chat model selector already supersedes it |
| 37 | Stacked diff layout (2025-09-04) | **yes, as improvement** | W11 | "when you do deep review you'll see what we have and what we can increase +improve" |
| 38 | Render images in the diff viewer (2025-08-22) | **yes** | W11 | "yes+same" — improve on what exists |
| 39 | Web-app verification + Playwright screenshots (2025-08-07) | **defer** | — | re-entry: `previewAutomation.ts` contract port + W1 side_pane_images plumbing make it cheap later |
| 40 | Export at any time (2025-08-15) | **yes** | W5 | mid-task WIP → branch/PR, no agent cooperation required |
| 41 | Open a PR directly (2025-08-04) | **yes** | W5 | real PR creation — today `createPR` only opens a compare URL in the browser |
| 42 | Copy/download buttons in code view (2025-06-06) | **defer** | — | re-entry: W5 changeset download covers the bulk of it |
| 43 | Adjustable code panel width (2025-06-06) | **yes** | W11 | persisted per window; split-ratio machinery already exists in `sub-chat-store.ts` |
| 44 | Pause/resume/delete from sidebar + copy task URL (2025-07-03) | **defer** | — | re-entry: after W1/W3 land, since pause semantics must sit on the new run lifecycle |
| 45 | Task modals — start tasks without leaving context (2025-06-06) | **yes** | W11 | `NewTaskDialog` wrapping the existing new-chat form |
| 46 | Commit authoring: 3 modes, user-level, all task types (2026-02-19) | **yes** | W9 | supersedes today's boolean `includeCoAuthoredBy` in `~/.claude/settings.json` |
| 47 | Hosted MCP connections + auto-invocation (2026-02-02) | **yes, own UX** | W12 | "we have or will have better ux +ui standards for mcp management" → build on `docs/design-system-baseline.md` §4.6, not Jules' paste-a-key panel |
| 48 | MCP allowlist security posture + request-next (2026-02-02) | **defer** | — | re-entry: before any hosted/relay surface ships |
| 49 | Micro-UI polish (2025-07-03) | **yes** | W11 | recessive non-urgent icons, toned-back hovers, consistent system-message padding |
| 50 | Reliability: queueing, GitHub sync, failure reduction (2025-05-22/30) | **partial — stuck-session half only** | W1 | user chose "Yes, but only the stuck-session half": no queue/backpressure hardening beyond what run integrity needs |
| 51 | Proactive web search (2025-08-08) | **yes, form decided by me** | W12 | "when you understand the codebase you'll know better" → research lane + domain policy (see plan §W12) |
| 52 | Test-verified patches as the completion contract (2025-06-20, 2025-05-19) | **yes** | W5 | no "done", no publish, without evidence |
| 53 | Status correctness + mobile/narrow (2025-05-22) | **defer** | — | formal state-machine rewrite deferred; the lying-status *bug class* is fixed in W1, which the user accepted |
| 54 | Talk-Like-a-Pirate persona day (2025-09-19) | **no** | — | asked, then declined after scoping |

Tally: 34 accepted (6 of them escalated or reinterpreted), 6 scoped behind the remote profile,
8 deferred with re-entry triggers, 6 rejected.

## Custom answers, verbatim (these are requirements)

- **#23 → W3**: *"something like this but you can "threadmaxx" basically you'll be able to for
  example tell the agent to open each item in a curated plan in a new chat so you can perfectly
  continue /chat those "subchats" in the custom runtime, but also the chat that created the
  subchats can also prompt them, monitor them to report back manage them etc, when or if asked."*
  Clarified scope: **"all 3 choosable"** (fan-out only / full parent supervision / dedicated
  orchestrator agent — user-selectable per run).
- **#24 → W6**: *"not doing a cli but something like this in the new sidebar the wip branch is
  working on but auto pr detecting with high end qol state detection like t3code nightly did it,
  deeply fetch their code to see implementation."* Clarified scope: **"yes both"** — read-only state
  detection *and* auto-PR lifecycle, with the instruction to evaluate `pingdotgg/t3code` deeply.
- **#31/#32 → W10**: memory and instructions are to be *ported deeply from hermes-agent's memory and
  context-loading logic*, automatic, and explicitly **performance-positive**.
- **#26–30 → W13**: environment machinery is scoped to *remote work*, **optional**, and acknowledged
  as sitting on top of not-yet-stable ground. Do not build it as a local-path feature.
- **#14 → W8**: *"when you deeply read the codebase you'll understand"* → delivered as scratch
  (no-repo) sessions using the existing `chats.create({ useWorktree: false })` path, with
  promote-to-project as the local inversion of Jules' download-the-output flow.
- **#35 → W11**: sample prompts must be *"genuinely useul … constantly updated over chat
  suggestions"* → derived from the user's own session history and repo signals, refreshed, never a
  static marketing list.
- **#47 → W12**: MCP management follows **our** UX/UI standards, not the changelog's shape.
- **#37/#38 → W11**: *"when you do deep review you'll see what we have and what we can increase
  +improve"* → the diff surface is an improvement pass on `agent-diff-view.tsx`, not a new viewer.

## Noted while triaging

- This repo's CI has no agent-trigger workflow (`.github/workflows/` = `ci.yml`, `lock-regen-temp.yml`) and
  `.git/config` holds no label keys, so the `jules`-style issue-label trigger from the changelog has nothing
  to collide with here. Wave W7 still defaults the trigger label to `mauscode` (configurable per project) so
  the feature carries mausCode identity rather than the upstream product's name.
- Cross-checked while triaging: items #31/#32 (memory + instructions) land on ground this repo has already
  broken — the vendored runtime ships a full memory graph and a per-turn inject pipeline, while our own
  instruction files (`CLAUDE.md`, `openspec/project.md`) are substantially wrong. The plan makes instruction
  truth a prerequisite wave (W0) rather than a footnote.
