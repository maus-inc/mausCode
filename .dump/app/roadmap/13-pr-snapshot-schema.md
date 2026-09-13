## 0. Meta

| Field | Value |
| --- | --- |
| Step | 13 of 45, parity P6 first half, wave W6 prerequisite |
| Area | db, main, shared |
| Risk | high |
| Depends on | {{S03}}, {{S12}} |
| Blocks | {{S14}}, {{S15}}, {{S16}} |
| Estimate | medium |

## 1. Outcome

A pull request is a record with provenance and a sync time, not two columns the renderer overwrites. `chats` gains the snapshot fields, and the write path records who linked it.

## 2. Why it matters

Only `prUrl` and `prNumber` are persisted, at `src/main/lib/db/schema/index.ts:58-59`, verified this session, and `chats.updatePrInfo` writes exactly those. So a restart loses the PR state, an externally merged PR leaves a session open forever, and there is no way to tell a PR the agent opened from one a human typed in. The vocabulary for all of it already exists in this repository as dead code.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Two PR columns today, and `updatePrInfo` writes only them | `src/main/lib/db/schema/index.ts:58-59`, `src/main/lib/trpc/routers/chats.ts:1657` | first path E1 this session, second recorded, re-verify |
| The snapshot type already models what is missing, including `checksState`, `mergeability`, `reviewDecision`, `syncedAt`, `source`, `linkedAt` | `src/shared/contracts/orchestration.ts:644-699` | recorded, verify by opening before use |
| `baseComparison` and the reaction enum are typed too | `src/shared/contracts/pullRequest.ts:124`, `:165` | recorded |
| 24,860 lines of vendored contracts have zero importers outside their own directory | `find src/shared/contracts -name '*.ts' \| xargs wc -l`, `grep -rl "shared/contracts" src \| grep -v ^src/shared/contracts` | E3, this session |
| The read path already fetches most of it and throws the result away on restart | `src/main/lib/git/github/github.ts:16-17` flat 10 s cache, `GitHubStatus.pr` carrying `state`, `reviewDecision`, `checksStatus` | E1, this session for the cache |

## 4. Read first, and what already exists

`.dump/app/research/2026-09-13-t3code-pr-state-spike.md` §1 and §6 are the design: name the columns exactly as the snapshot does so the protocol file can be reused, and stay one-to-one per chat until stacks exist. `AGENTS.md` says treat `src/shared/contracts` as available vocabulary, not a live path, and this step is the exception the record asks for: these two files become the first importers.

## 6. Implementation plan

1. Add to `chats`: `prSource`, `prLinkedAt`, `prSyncedAt`, `prState`, `prTitle`, `prHeadBranch`, `prBaseBranch`, `prIsDraft`, `prReviewDecision`, `prChecksState`, `prMergeability`, `prBaseComparison`, `prAdditions`, `prDeletions`, `prChangedFiles`. All nullable, one migration, generated.
2. Type the row shape in `src/shared` by importing the contract types rather than re-declaring them, and keep `src/shared/contracts/pullRequest.ts` verbatim so a re-port stays mechanical.
3. Replace `chats.updatePrInfo` with two procedures: `chats.linkPullRequest` taking a source of `manual`, `created`, `agent` or `stack`, and `chats.syncPullRequestSnapshot` writing the snapshot plus `syncedAt`. Derive the link in main, never accept a URL from a rendered string.
4. Retire the scrape that writes PR state from Bash output, `src/renderer/features/agents/utils/git-activity.ts:86`, recorded in the plan as the only writer today. Grep for its callers before deleting, and keep any UI that depends on it working.
5. Register the new columns in the export and wipe paths, and read the live schema in the test.

## 7. Contracts this changes

| Contract | Before | After |
| --- | --- | --- |
| Persistence | 2 columns | snapshot with provenance, forward-only migration |
| tRPC | `updatePrInfo` renderer-supplied | `linkPullRequest` plus `syncPullRequestSnapshot`, derived in main |
| Shared | contracts unused | `pullRequest.ts` and two types from `orchestration.ts` imported |

## 8. Boundaries

- Always: new columns nullable, one migration, source recorded on every link.
- Ask first: adopting more of the vendored contracts than these two files, which is the policy question in `.dump/global/questions.md` item 12.
- Never: infer a PR from a branch name or from `gh pr list` recency, and never accept a repository URL from rendered content as proof.

## 10. Acceptance criteria

- [ ] A reload restores PR state, and an externally merged PR settles: both proven by tests.
- [ ] `prSource` distinguishes agent-created from manual in a test, and a scrape can no longer write it.
- [ ] `syncedAt` is set by the sync procedure only, and the sidebar can tell a stale snapshot from a fresh one.
- [ ] Two vendored files become the contracts' first importers, with the rest still unused and still documented as such.
- [ ] Migration applies to a copy of a real `~/.mauscode` database, with existing rows intact.

## 11. Verification

```sh
npm run db:generate && git diff drizzle/    # read the SQL
npm run test && npm run typecheck && bun x biome check .
```

## 13. Rollback

New columns are additive and unread by the old code, so a revert is clean. Never edit the shipped migration to undo it; add a forward one.

## 14. Out of scope

Cache policy, `dedupeChecks`, the sidebar widget and the reaction, all in {{S15}}. Real PR creation is {{S14}}. A `pull_request_links` table stays out until stacks exist, per the spike's open question 1.

## 15. Handoff notes

Record the column list and its mapping to the contract fields in `.dump/app/research/2026-09-13-pr-snapshot-schema.md`, and state the adopt-per-use decision in `.dump/app/decisions/` so the next importer is a choice, not a drift.
