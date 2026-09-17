## 0. Meta

| Field | Value |
| --- | --- |
| Step | 14 of 45, wave W5 |
| Area | main, renderer |
| Risk | high |
| Depends on | {{S10}}, {{S13}} |
| Blocks | {{S16}}, {{S21}}, {{S26}}, {{S33}} |
| Estimate | large |

## 1. Outcome

A finished run produces a parsable change set, a downloadable patch, and a real pull request opened through `gh` with an evidence bundle attached. The compare-URL button becomes a pull request.

## 2. Why it matters

`createPR` at `src/main/lib/git/git-operations.ts:543` builds `https://github.com/${repo}/compare/${branch}?expand=1` and hands it to `shell.openExternal`, verified by reading those lines this session. So the agent's work ends at a web form: the user writes the title, picks the base, pastes the summary, and the app keeps no record of what it produced. Triage rows 15, 40 and 52 asked for the change set, the export at any time, and test-verified evidence as the completion contract, and the plan puts all three in this wave because they are the same object.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| `createPR` opens a compare URL, returning `{ success, url }` | `src/main/lib/git/git-operations.ts:543-583` | E1, this session |
| `gh` is already the GitHub surface, with `gh pr view --json` for the read path | `src/main/lib/git/github/github.ts:91-105` | recorded, verify the line |
| PR state can now be persisted with provenance | step 13 | by contract |
| The export and wipe paths enumerate tables, so the new evidence record must register | `FULL-REVIEW.md` §16 pattern | E1 |
| Unattended work needs evidence before it may claim done | `.dump/app/plans/2026-09-12-jules-port-plan.md` §6 non-negotiables | recorded |

## 4. Read first, and what already exists

`src/main/lib/git/` already owns worktree state, status, numstat and the lock helper `withGitLock`, so extend it rather than adding a git module. `docs/design-system-baseline.md` governs the diff and details surfaces. The change set shape, `[A]`, `[M]`, `[D]` with per-file counts and totals, is specified in triage row 15, and `chats` already caches nothing, which is why the counts must be computed once and stored.

Known gap from PR review of the wipe path this step registers into: the debug wipes settle active runs before deleting, and a delete failure after the settle leaves the chats with cancelled runs. That state is coherent only because the settle precedes the delete. Keep that ordering when registering the evidence table, and treat making settle-plus-delete one transactional unit as the follow-up if this step grows a reason to.

## 6. Implementation plan

1. `changeset.get(subChatId)`: per-file status, additions and deletions, totals, base commit, and the branch, computed against the recorded base rather than `HEAD`.
2. `changeset.patch(subChatId)` returning a `git format-patch` style bundle, written to a temp file the renderer saves through the existing dialog path. Mid-task export must work while the run is live, per triage row 40.
3. `EvidenceBundle` persisted per run: the commands run with their exit status, the test counts, the diff stat, the base and head SHAs, and the model and mode. Register the table with the wipe and export paths.
4. Replace `createPR` with a real flow: push the branch, `gh pr create` with a body the app assembles from the plan, the change set and the evidence bundle, then write the snapshot with `prSource: "created"`. Keep the compare URL as the fallback only when `gh` is absent or unauthenticated, and say which happened in the UI.
5. Validate every URL before `shell.openExternal`, including the fallback, per `AGENTS.md`.
6. Errors surface as a named cause: no remote, no `gh`, no auth, dirty tree, non-fast-forward. Each with the command the user can run.
7. Tests against a temp repository fixture for the change set, the patch and the create path, and a `gh` mock for the create call so no test touches the network.

## 8. Boundaries

- Always: URL validation before any external open, evidence before a completion claim, one push per user action.
- Ask first: any default that publishes without an explicit user action, and any body content that includes a file the user did not include in the run.
- Never: force-push to a shared branch, merge without the human's exact confirmation, widen approvals to make a push succeed, or include a secret or a `.env` in a patch.

## 10. Acceptance criteria

- [ ] A finished run shows `[A]`, `[M]`, `[D]` with per-file and total counts matching `git diff --stat` on the same base.
- [ ] The download produces a patch that applies to a clean checkout of the base, proven by a test.
- [ ] `createPR` opens a real pull request whose body carries the change set and the evidence summary, and `prSource` reads `created`.
- [ ] A run with no passing test has no way to claim completion, enforced in code, not in copy.
- [ ] With `gh` absent, the flow reports that and offers the compare URL rather than failing silently.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
node scripts/ci/lint-changed.mjs
```

Manual: create a scratch worktree, run one edit turn, export, and open the PR against a throwaway repository.

## 13. Rollback

Keep the compare-URL behaviour as a named fallback for one release, then delete it. Reverting the step returns to the button that opens a URL.

## 14. Out of scope

Reading review comments and reacting, which is {{S16}}. Render-deployment webhooks, rejected in triage row 12. Copy buttons in the code view, deferred in row 42 to this step's download.

## 15. Handoff notes

Record the evidence bundle schema in `.dump/app/plans/2026-09-13-evidence-bundle.md`. Every unattended step cites it, so the field names are a contract.
