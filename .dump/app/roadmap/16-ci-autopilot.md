## 0. Meta

| Field | Value |
| --- | --- |
| Step | 16 of 35, wave W6 second half |
| Area | main, renderer |
| Risk | critical, because it is unattended and it pushes |
| Depends on | {{S07}}, {{S09}}, {{S10}}, {{S14}}, {{S15}} |
| Blocks | {{S21}}, {{S22}} |
| Estimate | large |

## 1. Outcome

Two bounded autopilots. One watches checks on a pull request this session created, reads the failing log, pushes a fix and resubmits, capped at three attempts. The other watches review comments, marks the pull request as seen with `👀`, commits what it can and replies, optionally only when mentioned.

## 2. Why it matters

Triage rows 1 and 11 accepted both, and the plan sequences them after the permission floor and the real PR because they push code without a human watching. The pieces that make them safe are all upstream of this step: run records so a fix is attributable, the event mapper so a completion is real, the permission floor so a repair cannot escalate itself, and persisted PR state so the loop knows what it already did.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Checks and review state are readable in one fetch today | `src/main/lib/git/github/github.ts:91-105` `gh pr view --json` field list | recorded, verify |
| Reactions are typed but unused | `src/shared/contracts/pullRequest.ts:165` | recorded |
| The cap and the reaction are decisions already taken, not open questions | `.dump/app/plans/2026-09-12-jules-port-plan.md` W6 | recorded |
| Unattended writes must not rewrite what a user recorded, the same rule memory follows | `.dump/app/research/2026-09-13-hermes-memory-spike.md` §4 | recorded |
| Every run needs an evidence bundle before it may claim done | step 14 | by contract |

## 4. Read first, and what already exists

`src/main/lib/git/github/` for the fetch path, `src/main/lib/git/worktree.ts` for the checkout the fix runs in, and step 15's cache policy, which is what stops this from becoming a `gh` rate-limit incident. `run_events` from step 07 is where each attempt is recorded. There is no scheduler yet, so the loop rides the run subscription; step 21 gives it a clock.

## 6. Implementation plan

1. One module, `src/main/lib/autopilot/`, with two watchers over one primitive: read state, decide, act, record. Do not build two loops.
2. CI repair: on a failing check, fetch the log through the existing `gh` path, cap the bytes, and hand the fixer the failing task, the diff stat and the base SHA. Fix, commit with the authorship rule from step 21, push, resubmit. Three attempts maximum, then a written handoff in the activity feed naming what it tried and what remains.
3. Review response: poll comments, react `👀` once per thread, apply only changes inside the run's file allow-list, reply with what was done. Reactive Mode restricts the trigger to `@`-mentions, per triage row 11.
4. Both watchers off by default, per workspace, and both refuse to run when the permission floor would have to be widened to succeed.
5. Persist every attempt as a run with an evidence bundle, so the fix is reviewable after the fact and the count survives a restart.
6. Kill switches: one setting that stops all unattended pushes, and a hard rule that a run may not merge, close or approve anything.
7. Tests: capped attempts, log truncation at the byte limit, the file allow-list rejecting an out-of-scope edit, a restart mid-loop resuming at the right attempt count, and the reaction applied once.

## 8. Boundaries

- Always: attempt cap, evidence bundle per attempt, file allow-list, deny by default.
- Ask first: any action a stranger can see, meaning push, comment, react and reply, and any extension of what the fixer may touch.
- Never: `bypassPermissions`, a merge, a force-push, an auto-approve of its own PR, a reply that quotes a secret, or a loop that outlives its cap because the counter was in memory.

## 10. Acceptance criteria

- [ ] A scripted failing check gets at most three repair attempts, each recorded, then a handoff message with the residual failure.
- [ ] A review comment on a file outside the allow-list produces a reply and no commit.
- [ ] `👀` appears once per thread across a restart.
- [ ] With the master setting off, no network write happens, asserted by a mock `gh` recording calls.
- [ ] A rate-limited lookup widens the poll gap instead of hammering, using step 15's backoff.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
```

Manual, on a throwaway repository: break a check on purpose, enable the watcher, and read the three attempts in the activity feed.

## 12. Benchmark record

`gh` calls and wall time per repair attempt, in `.dump/app/benchmarks/`.

## 13. Rollback

Both watchers sit behind a per-workspace flag that defaults off, so turning them off is the rollback. Reverting the code leaves the flags unused.

## 14. Out of scope

Render-deploy and third-party webhook fixes, rejected in triage row 12. Slack, Linear and Jira triggers, rejected in row 17. Scheduled runs of the same loop are step 21.

## 15. Handoff notes

Record the attempt policy, the allow-list shape and the exact `gh` commands in `.dump/app/plans/2026-09-13-autopilot.md`, since {{S21}} and {{S22}} reuse both the loop and the honesty rules.
