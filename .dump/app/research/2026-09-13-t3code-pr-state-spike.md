# Spike: how t3code actually does pull-request state — and what mausCode should take

**Date:** 2026-09-13 · **Status:** research, no code changed · **Feeds:** plan waves W5 (push + open PR), W6 (CI repair, PR feedback, repo inference), and the release-parity program's P6

Source read: `/tmp/t3code`, HEAD `8ddd9f7e` ("fix(desktop): bound backend shutdown wait during quit (#7599)"), MIT licence, pnpm monorepo (`apps/server`, `apps/desktop`, `packages/contracts`, `packages/client-runtime`, …). Read paths are inside that clone.

## Why this spike exists

The standing instruction was: do not copy t3code's inference of "which repo/branch/PR am I in"; build state detection at the same standard as theirs. That requires knowing what their standard *is*. It turns out to be three things, in this order of value to us:

1. a **link record** that persists per-thread PR state, refreshed on a clock;
2. a **cache policy** that treats a failed lookup differently from a successful one;
3. a **check-list normalisation** rule that stops a re-run from looking like two checks.

None of them is machine learning. The "high-end QoL" comes entirely from data modelling and refresh timing, which is good news for us: they are implementable in one wave, and partly already in our tree.

## 1. The state model is already vendored into mausCode — and unused

`src/shared/contracts/orchestration.ts` (our copy of their `packages/contracts/src/orchestration.ts`) already contains, with line numbers measured in our tree:

| What | Our file | Contents |
| --- | --- | --- |
| `ThreadPullRequestLinkSource` | `:630-637` | `manual \| created \| agent \| stack \| stack-dismissed` |
| `ThreadPullRequestSnapshot` | `:644-662` | `state, title, headBranch, baseBranch, isDraft, updatedAt, syncedAt`, then **optional** `closedAt, mergedAt, author, additions, deletions, changedFiles, reviewDecision, checksState, mergeability` |
| `ThreadPullRequestKey` / `ThreadPullRequestLink` | `:684-699` | host + repository + number identity, `url`, `source`, `linkedAt`, `snapshot`, `stack` |
| link onto a thread | `:714`, `:799` | `pullRequests: Schema.Array(ThreadPullRequestLink)` on the thread record |
| write commands | `:1151-1157` `ThreadPullRequestLinkCommand`; `:1475-1480` `ThreadPullRequestLinkSyncCommand`; `:1684-1686` `ThreadPullRequestLinkedPayload` | link, refresh-snapshot, push-to-client |

and `src/shared/contracts/pullRequest.ts` already defines `PullRequestChecksState` (passing/failing/pending, `:75`), `PullRequestMergeability` (`:78`), `PullRequestBaseComparison` (`up-to-date \| behind \| unknown`, `:124`), `PullRequestReactionContent` (`:165`), `PullRequestReviewThread` (`:237`), `PullRequestComment` (`:196`).

**Consequence for the plan:** W5/W6 are *not* a type-design task. The vocabulary and the wire protocol exist and are dead code (0 importers). The work is the server half that fills them in and the UI half that reads them. That also means the earlier decision "keep the vendored types as the reference, build the app on zod/Drizzle" needs one adjustment: these two files are the *only* vendored contracts worth wiring up first, because our Drizzle table carries **two** PR columns (`src/main/lib/db/schema/index.ts:58-59`: `prUrl`, `prNumber` — measured, and `updatePrInfo` writes exactly those) and is therefore a lossy subset of `ThreadPullRequestSnapshot`, which also has `syncedAt`, `checksState`, `mergeability`, `baseComparison`, `reviewDecision`, and the `source`/`linkedAt` provenance that makes agent-created PRs distinguishable from manual ones.

## 2. Discovery: match, then prove, then settle

`apps/server/src/git/GitManager.ts` (their server):

* A PR belongs to a worktree when `pr.headRefName === headContext.headBranch` (`:379`, `resolvePullRequestHeadIdentity` at `:360`). No fuzzy matching, no "most recent branch that looks like a PR branch".
* Repository URLs are validated before an automatic link is accepted, and there is an explicit guard against auto-settling an unrelated feature thread (`:1463` comment, `:1573-1604` where `toPullRequestInfo` results are keyed `parsedByNumber` and merged with the requested list).
* `refreshMissingPullRequest?: boolean` (`:84`, `:1170-1176`, `:1258`) is a *parameter*, not a background job: the caller decides when a missing link is worth another lookup.
* Ordering is deterministic: `pullRequestUpdatedAtDescOrder` (`:190`).

**Adopt:** link-by-head-branch plus repository-URL proof. **Reject:** inferring a PR from the branch name or from `gh pr list` recency. Our current `updatePrInfo` (`src/main/lib/trpc/routers/chats.ts:1657`) stores whatever the renderer hands it — its only caller is `active-chat.tsx:2949` — so provenance is unrecorded today; adding `source` and `linkedAt` is the cheap fix that makes the agent-opened PRs auditable.

## 3. Cache policy: the part worth stealing whole

`GitManager.ts:137-164`, with their own comments:

```
STATUS_RESULT_CACHE_TTL     = 1s      // branch status reads
PR_LOOKUP_CACHE_TTL         = 60s     // matches the settlement sweep cadence,
                                      // so "an external merge settles within about a minute"
PR_LOOKUP_FAILURE_BASE_TTL  = 20s
PR_LOOKUP_FAILURE_MAX_TTL   = 15min   // exponential: base * 2^exponent, capped
```

and the reasoning, verbatim in intent: *"A hosting provider rejects a throttled request immediately, so caching [a failure] the way a healthy one does (which waits PR_LOOKUP_CACHE_TTL) turns a transient 429 into a 60s blind window."* Both caches express this as a per-result TTL — `timeToLive: (exit) => Exit.isSuccess(exit) ? STATUS_RESULT_CACHE_TTL : Duration.zero` (`:1001`, `:1272`) — and cache keys are NUL-joined (`:1020`).

`apps/server/src/pullRequest/PullRequestReadCache.ts` (125 lines) wraps the same idea as a service with `invalidate` = `Cache.invalidateAll` (`:95`), so a git mutation can clear reads in one call.

**Adopt verbatim as policy:** success TTL 60s for PR lookups, failure backoff 20s → cap 15min, zero-TTL for negative branch-status results, one invalidator called from commit/push/PR-create. Our `src/main/lib/git/github/github.ts` today has a fixed 10s module cache with no failure branch — that is the concrete gap this closes, and it is why a 429 currently makes the sidebar lie for a whole tick.

## 4. Check normalisation: one row per check, not per run

`apps/server/src/pullRequest/pullRequestChecks.ts` (55 lines, **Effect-free** — it imports only a type from contracts; measured by `grep -c "Effect|Schema"` → 0). `dedupeChecks` at `:30` with the rule spelled out in its doc comment:

* GitHub hands back a list of *runs*, not of *checks*; a re-run arrives as an apparent duplicate with no id, so identity = name qualified by workflow.
* newest run wins; a run with no timestamp loses to one that has it; ties go to the later row, because hosts list a re-run after the run it repeats (`isAtLeastAsNew` compares ISO-8601 UTC strings as text — no date parsing).
* order is the host's own, held at first appearance, so a re-run replaces a row **in place** instead of reshuffling the list under the reader.
* two survivors under the same name are genuinely different checks → displayed `workflow / name`, "the way GitHub writes it itself"; a survivor with no workflow name keeps its bare name.

**Adopt as-is.** This is a whole class of "the CI panel flickers / shows two 'build' rows" bugs, solved in 55 lines, and it is the only piece of their PR layer that needs no translation.

## 5. Host payloads and reactions

`gitHubPullRequestJson.ts` (2,592 lines) is the GraphQL/CLI reader: `RawListItemSchema` pulls `statusCheckRollup` as a whole optional field (`:78` comment: it *"comes along with `statusCheckRollup` already — it is asked for as a whole field"*, so asking separately is wasted quota), plus `RawReviewSchema`/`RawCommentSchema`/`RawCommitSchema`/`RawActivitySchema` (`:346-419`), `RawStatsSchema` (`:213`), stack membership (`:115`, `:235`), `REACTORS_PER_GROUP = 10` with a shared `REACTION_GROUPS_FIELDS` fragment (`:243-262`), and a **bidirectional** reaction map (`REACTION_CONTENT_BY_GITHUB` `:264`, `gitHubReactionContent` `:286`) so `👀` round-trips instead of being stringly handled.

Four hosts are implemented behind one interface: `PullRequestProvider.ts` (the contract, with `checksState?` at `:93`/`:115`), `PullRequestProviderRegistry.ts`, then GitHub / GitLab / Bitbucket / Azure DevOps, each `XxxPullRequestCli.ts` + `xxxBlaJson.ts` + a co-located `.test.ts`. `GitHubPullRequestCli.ts` alone is 2,456 lines.

**Adopt:** the shape of the single-fetch query (rollup + reviews + comments + reactionGroups in one round-trip), the reaction map for the 👀 feature, and the provider-as-interface pattern. **Reject:** porting the multi-host breadth (we are GitHub-only via `gh`; four providers is four maintenance surfaces for users we don't have).

## 6. Verdict for the plan

| t3code mechanism | our equivalent | decision |
| --- | --- | --- |
| `ThreadPullRequestLink` + `Snapshot` with `syncedAt` | Drizzle `chats.pr*` columns (subset) | extend columns: `prSource`, `prLinkedAt`, `prSyncedAt`, `prChecksState`, `prMergeability`, `prBaseComparison` |
| link by `headRefName` + repo-URL proof | none (renderer-supplied) | derive in main, keep manual link as `source: "manual"` |
| success/failure split TTL, NUL keys, one invalidator | 10s flat cache | copy the numbers, adapt to TS (no Effect needed for a TTL map) |
| `dedupeChecks` | none | vendor verbatim + attribution header + their tests |
| reaction map, single-fetch query | ad-hoc `gh pr view` | adapt queries; keep `👀` mapping |
| 4-host provider registry | `gh` only | skip |

Licence/attribution: files we take verbatim get the upstream header the porting recipe already requires (`docs/backend-porting-recipe.md` §0); files we adapt say "not verbatim" and keep the behaviour narrow. Nothing from this spike should reach the renderer as T3 branding — identity is locked by `src/shared/app-identity.ts`.

## 7. Open questions (not blockers)

1. Do we mirror their `link`-as-first-class-object (a table `pull_request_links`) or keep columns on `chats`? Their model allows one thread ↔ many PRs (stacks); ours is 1:1. Recommendation: stay 1:1 until stacks exist, but name the columns exactly as the snapshot does so the protocol file can be reused.
2. Do we run a 60s "settlement sweep" of our own (their cadence exists so an externally-merged PR clears a session row within a minute)? Our `runs.subscribe` subscription could carry it for free; a poll timer would be simpler and is what the CI-fixer wave needs anyway.
3. Their `refreshMissingPullRequest` is caller-driven. Should our CI-repair autopilot force a refresh before concluding "no PR"? Yes — otherwise a just-pushed branch reports no PR for up to a minute.
