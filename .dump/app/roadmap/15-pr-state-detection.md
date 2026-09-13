## 0. Meta

| Field | Value |
| --- | --- |
| Step | 15 of 35, wave W6 first half, parity P6 second half |
| Area | main, renderer |
| Risk | high |
| Depends on | {{S06}}, {{S13}} |
| Blocks | {{S16}}, {{S22}} |
| Estimate | medium |

## 1. Outcome

The sidebar knows which repository, branch and pull request a session belongs to, refreshes on a policy that treats a failure differently from a success, and shows one row per check rather than one row per run.

## 2. Why it matters

`src/main/lib/git/github/github.ts:16-17` holds a flat 10 second cache with no failure branch, verified this session, so a rate limit makes the sidebar report nothing for a full tick and a caller cannot tell "no PR" from "we did not ask". `pr-status-bar.tsx` exists and is imported by nothing, verified by a repo-wide grep this session, so the component that would show this state has already been written and abandoned. Triage row 24 redirected the CLI's repo inference into exactly this feature, at the standard the plan names after reading t3code's code.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Flat 10 s cache, no failure branch | `src/main/lib/git/github/github.ts:14-26` | E1, this session |
| A dead consumer waiting for a data source | `src/renderer/features/agents/ui/pr-status-bar.tsx`, zero importers | E3, this session |
| `prUrl` and `prNumber` alone are persisted, so restart loses everything else | `src/main/lib/db/schema/index.ts:58-59` | E1, this session |
| The numbers to copy: 1 s for branch status, 60 s on PR success, 20 s to 15 min exponential on failure, NUL-joined keys, one invalidator | `.dump/app/research/2026-09-13-t3code-pr-state-spike.md` §3 | recorded |
| A 55 line Effect-free `dedupeChecks` that collapses re-runs per `workflow / name` | same spike §4, upstream `apps/server/src/pullRequest/pullRequestChecks.ts:30` | recorded, port it verbatim with the attribution header |
| Discovery rule to copy: `pr.headRefName === headBranch`, plus a repository-URL proof | same spike §2 | recorded |

## 4. Read first, and what already exists

`fetchGitHubPRStatus` already does the right shape, repo URL, current branch, then a parallel `branchExistsOnRemote` and `getPRForBranch`, so this step adds persistence, cache policy and de-duplication rather than a new read path. `GitHubStatus.pr` already carries `state`, `reviewDecision`, `checksStatus` and `checks[]`. The reaction enum lives in `src/shared/contracts/pullRequest.ts:165` from step 13.

## 6. Implementation plan

1. Vendor `dedupeChecks` and its tests verbatim with the upstream attribution header the recipe §0 requires, in `src/main/lib/git/github/checks.ts`. It is pure, so it needs no translation.
2. Replace the module cache with one cache object holding a per-result TTL: 60 s on success, exponential 20 s doubling to a 15 minute cap on failure, zero for a negative branch-status read. Keys joined with NUL so a path containing a colon cannot collide.
3. Expose one `invalidateAll` called from commit, push and PR create, mirroring the existing `invalidateGitStateCaches` in `src/main/lib/git/`. Grep for it before adding a second invalidation path.
4. Derive the link in main: current branch, then `gh pr list --head <branch>` for the candidate, accepted only when the repository URL matches. Manual links from step 13 stay `source: "manual"`.
5. A settlement sweep on the subscription the run already holds, at 60 s, plus a forced refresh before any code concludes "no PR" for a branch that was just pushed. That is the spike's open question 3, answered yes.
6. Wire `pr-status-bar.tsx` into the details sidebar as a widget consuming the snapshot, or delete it and say why. Both are honest, leaving it dead is not.
7. Show `baseComparison` as `up-to-date`, `behind` or `unknown`, and one row per check with `workflow / name` when two survive the same name.
8. Tests: TTL split with a fake clock, the failure backoff cap, de-duplication against a captured re-run payload, and the link rejection when the repository URL does not match.

## 8. Boundaries

- Always: match then prove then settle, never a name heuristic.
- Ask first: any shortening of the failure backoff, which is the rate-limit shield, and any new `gh` query that is not the single-fetch shape.
- Never: a poll timer in the renderer, a token in a query string, or a widened approval to make a lookup work.

## 10. Acceptance criteria

- [ ] A 429 produces a growing gap between attempts, visible in a log line with the seconds, and the UI keeps the last snapshot rather than clearing it.
- [ ] A re-run of one check shows one row. A test asserts the count from a captured payload with two runs.
- [ ] An externally merged PR settles within about a minute with the app open, and the session row updates.
- [ ] A branch whose name matches a PR in another repository is not linked, proven by a test.
- [ ] `pr-status-bar.tsx` is imported somewhere or gone.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
```

## 12. Benchmark record

`gh` invocations per minute per open session, before and after the cache policy, in `.dump/app/benchmarks/`.

## 13. Rollback

The cache and the sweep are additive. Revert leaves step 13's snapshot columns unread, which is safe.

## 14. Out of scope

Fixing CI, reacting to review comments and Reactive Mode, which is {{S16}}. GitLab, Bitbucket and Azure DevOps providers, rejected in the spike's §6.

## 15. Handoff notes

Answer the spike's open question 2 in `.dump/app/research/2026-09-13-pr-state-implementation.md` with what you actually shipped, sweep or subscription, so {{S16}} builds on the real mechanism.
