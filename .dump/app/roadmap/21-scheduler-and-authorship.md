## 0. Meta

| Field | Value |
| --- | --- |
| Step | 21 of 35, wave W9 |
| Area | main, renderer, db |
| Risk | high |
| Depends on | {{S10}}, {{S14}}, {{S16}}, {{S19}} |
| Blocks | {{S22}} |
| Estimate | medium |

## 1. Outcome

mausCode runs a task on a schedule, locally, and writes commits with an authorship the user chose rather than a boolean flag in another product's settings file. The existing automations screens become local state instead of a hosted feature that is inert.

## 2. Why it matters

The automations UI is present, `src/renderer/features/automations/automations-view.tsx`, `automations-detail-view.tsx` and `inbox-view.tsx`, and it points at a control plane that does not exist for this product, so it renders nothing useful. Triage rows 8 and 9 asked for scheduled tasks with in-place edit, pause and resume, and row 46 asked for commit authoring in three modes at user level across all task types, which supersedes the inherited boolean.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Automations surfaces exist and are hosted-shaped | `src/renderer/features/automations/`, 7 entries including `_components` and `inbox-styles.css` | E1, this session |
| Commit authorship is a boolean read from another product's config, and it defaults to on | `src/main/lib/trpc/routers/claude-settings.ts:118-124`, `return settings.includeCoAuthoredBy !== false` | E1, this session |
| The same router writes that file back, so mausCode mutates the user's Claude settings | `writeClaudeSettings` at `src/main/lib/trpc/routers/claude-settings.ts:108-112`, used by `setIncludeCoAuthoredBy` from `:127` | E1, this session |
| Unattended work needs the evidence bundle and the permission floor | steps 14 and 10 | by contract |
| Local-only is the product promise, so the clock must be ours | `CONTRIBUTING.md` local-only section, `src/shared/local-only.ts` | E1, this session |

## 4. Read first, and what already exists

`AGENTS.md` on minimal surface and on the shared owner. The automations views are the UI: re-point them at local procedures rather than rebuilding them. `src/main/lib/` has no scheduler of any kind, so one small module owns it, and the run record from step 07 is what a scheduled execution creates.

## 6. Implementation plan

1. Tables: `schedules` with cron expression, workspace, prompt, mode, engine, authorship policy, enabled, next run at, last run id. `schedule_runs` linking a schedule to its runs, so history survives a schedule edit.
2. `src/main/lib/scheduler/` with one timer module, `oneMinuteTick`, that claims due rows in a transaction so two windows cannot both fire the same schedule. That claim is the whole concurrency story, so write the test first.
3. A schedule run is an ordinary run with `origin: "schedule"`, inheriting the workspace permission policy and the unattended rules, so no separate execution path exists.
4. In-place mutation, per triage row 9: `schedules.update`, `.pause`, `.resume`, `.delete`, and the UI edits the row rather than deleting and recreating it.
5. Authorship: one policy in mausCode's own store, with three modes, none, agent only, agent plus human, applied to the commit trailer mausCode writes. Read the inherited boolean once at first run as a migration hint and then stop reading it.
6. Stop writing `~/.claude/settings.json` from this path. mausCode's preference lives in mausCode's tables, and the router may read the user's file for display, never write it.
7. Guard rails: a schedule never runs while the machine is on battery with the setting enabled, never more than N concurrently, and always lands a run record with the evidence bundle even on failure.
8. Tests: due-claim under a concurrent tick, pause surviving a restart, resume recomputing the next fire, authorship trailer on a real commit fixture, and a failing run still producing evidence.

## 8. Boundaries

- Always: one claim in one transaction, evidence per run, and inherited policy from step 10.
- Ask first: any scheduled action that reaches a human, meaning a comment, a push or a PR, and any default-on schedule.
- Never: a hosted cron service, writing another product's config file, or a schedule that can fan out children without the caps from step 19.

## 10. Acceptance criteria

- [ ] A daily schedule fires once, not twice, with two windows open, proven by a test.
- [ ] Edit, pause and resume work in place, and history survives all three.
- [ ] Commits carry the chosen authorship and nothing reads `~/.claude/settings.json` for a decision.
- [ ] A failed scheduled run leaves a run record with the failure, visible in the details sidebar.
- [ ] The automations views show local state with no control plane configured, which is the local-only promise tested.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
```

Manual: set a one-minute schedule in a scratch worktree, let it fire twice, and read the two runs.

## 12. Benchmark record

Idle cost of the scheduler tick, measured as CPU time per hour with zero and ten schedules, in `.dump/app/benchmarks/`. A timer that wakes the app every minute has to be cheap and has to be proven so.

## 13. Rollback

Schedules are inert once the module is removed, so revert the scheduler and keep the tables. Nothing writes elsewhere.

## 14. Out of scope

Ambient and overnight runners in the engine, which the competitive record keeps disabled until the trust model holds. Slack and issue-tracker triggers, rejected in triage row 17.

## 15. Handoff notes

Record the schedule row shape and the claim protocol in `.dump/app/plans/2026-09-13-scheduler.md`, and the authorship modes in `.dump/app/decisions/2026-09-13-commit-authorship.md`, since {{S22}} renders a schedule-created suggestion the same way.
