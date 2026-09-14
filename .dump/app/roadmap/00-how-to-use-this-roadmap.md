# 00. How to use this roadmap

This is the operator's manual for `.dump/app/roadmap/`. It is numbered `00` so it sorts before the steps, and it
is **not a unit of work**: there is no step 00, no issue for it, and nothing here to complete or close. The 45
steps are `01` through `45`. Everything about *how to work* a step lives in `AGENTS.md`, section "How to work a
roadmap step", and is not repeated here; this file only explains the machinery around it.

## 1. The three artifacts per step

| Artifact | Role | If they disagree |
| --- | --- | --- |
| `.dump/app/roadmap/NN-<slug>.md` | The truth. Full 16-section specification, written from measurements taken in the planning session | This wins |
| GitHub issue `#NN+2`, labelled `roadmap` | The task card and the place work is claimed, discussed and closed | Pointer, may lag |
| `AGENTS.md` | Ground rules, prevention rules, the 13-item method, gate commands | Always applies |

So step 07 is issue #9, step 22 is #24, step 45 is #47. The index is #48. The files keep `step {{SNN}}` tokens by
design, because a token survives a resequence while a hard number does not, and the rule for resolving one is
arithmetic: `{{SNN}}` is issue `#NN+2`. Twelve bodies were filed with the numbers substituted and twelve others keep
the token form; #48 is the resolver for both, and the drift pack in §6 explains which is which.

## 2. Reading one before you assign it

| Section | What it is for |
| --- | --- |
| 0. Meta | Estimate, risk, `Depends on`, `Blocks`. The dependency column is the law, see §3 |
| 1. Outcome | One paragraph, written so it can be restated in a sentence. If you cannot, say so instead of coding |
| 2. Why it matters | The bug or gap in plain language, with the path that shows it |
| 3. Evidence | Every claim with a path and a level: `E1` read this session, `E3` measured this session. An assertion with no row here is not evidence |
| 4. Read first / 5. What already exists | The files to open before designing, and the partial implementations to reuse rather than duplicate |
| 6. Implementation plan | Commit-sized steps in order. Follow them; deviating is fine, deviating silently is not |
| 7. Contracts this changes | Types, schemas, IPC and router shapes that move, so a reviewer knows what to diff |
| 8. Boundaries | Three lists: **Always**, **Ask first**, **Never**. `Never` is absolute, `Ask first` means stop and open a question with the recommendation attached |
| 9. Tests / 10. Acceptance criteria | What proves it, and the checklist a human can verify without reading code |
| 11. Verification | The exact gate commands to run, no substitutes |
| 12. Benchmark record | The `.dump/app/benchmarks/` file this step owes. A step that ships perf-affecting work with no record has not proven it is safe for the local-first promise |
| 13. Rollback / 14. Out of scope | How to undo it, and what an eager agent must resist adding |
| 15. Handoff notes | Which document in `.dump` to update in the same change, so the next agent does not re-derive this |

## 3. Ordering, in one rule

A step may start only when every step in its `Depends on` column is merged, and nothing in the second half of
the plan's sequence table may start before its dependencies land. That is why steps 01, 02 and 03 come first:
truth in the docs, gate policy, then one real end-to-end build whose recorded numbers become the baseline every
later performance claim quotes. Steps 10 and 11 are the two critical-risk gates everything unattended depends
on, so they precede the orchestration, critics and autopilot steps. Milestones are M1 for 01–05, M2 for the
run-integrity and permission work, M3 for orchestration and PR surfaces, M4 for memory, review, research and MCP,
M5 for the parked remote-environment step. The table in `.dump/app/plans/2026-09-13-mauscode-roadmap.md` §2 is
authoritative over this sentence.

Parallel assignment is allowed only between steps that share no file, no dependency in `package.json` and no
`.dump` path, and each takes the parallel-safety contract in `AGENTS.md` §"Running agents in parallel". Steps 17,
18 and 37 are a worked example of the exception: they touch the same drag surface, so they run as one owner with
one shared context.

## 4. Handing out a step

Paste this to an agent, filling the two numbers, and nothing else is required:

> Work roadmap step `NN` (issue `#NN+2`) on `arena/01a097c4-mauscode`. Read `AGENTS.md` in full first, then
> `.dump/app/roadmap/NN-<slug>.md`, then the files in its §4. Run `find-skills` before you design, per
> `AGENTS.md`. Do not start if any step in §0 `Depends on` is unmerged; say which one and stop. Follow §6 as the
> commit sequence, honour §8 including the `Ask first` list, and run §11 exactly. Finish with the §12 benchmark
> record written into `.dump`, the §15 handoff updates, gates green, and the PR body per
> `.github/PULL_REQUEST_TEMPLATE.md`. Never merge a branch without the exact confirmation wording in
> `AGENTS.md`.

Three things worth checking by hand when it comes back: whether the §3 evidence rows are still true after their
edits, whether anything in §14 out of scope crept in, and whether §12 actually has a number rather than a
sentence.

## 5. Closing a step

Close the issue from the merge, not before, and put the outcome in the file: append the measured result and the
date to the relevant `.dump` section, so a reader of the step sees what shipped. `CONTRIBUTING.md` requires the
benchmark record for anything touching startup, memory, rendering or file weight, and the plan carries the same
rule as a standing constraint on every step.

## 6. Drift, and what to do about it

Twelve bodies were written before the 2026-09-13 and 2026-09-14 decision batches and lag their files. The human
accepted that as the steady state rather than widen the GitHub scope, so each of the twelve, plus the index, gets a
dated drift comment saying what changed, with the exact text and a posting loop in
`.dump/app/plans/2026-09-14-issue-drift-notices.md`. Two rules follow for anyone reading an issue in this range.

- **Always open the file.** A body is a pointer that may be a day old, and closing a step against the GitHub copy
  alone is a review finding.
- A drift comment is the notice mechanism for this repository, so post one instead of quietly editing an issue body
  to match a file. If the integration ever gains issue write scope, the twelve are synced in one pass, the tokens
  are resolved, and §4b of the plan is deleted rather than maintained.

## 7. Numbering, if a step has to be added

Append, do not insert. A new step is `46`, its file is `.dump/app/roadmap/46-<slug>.md`, its issue is created
with `gh issue create` and labelled `roadmap`, and the plan's sequence table plus §7 index gain a row. Renumbering
mid-list would move every `#NN+2` relationship and invalidate the twelve drift notices, so a step that belongs in
the middle is written with its `Depends on` column doing the ordering work instead.

## 8. What is not in here

Product decisions are not in the roadmap; they are in `.dump/global/decisions.md`, and every one of the 18 open
questions that program started with was answered and closed in `.dump/global/questions.md`. Provider-backend work
follows `docs/backend-porting-recipe.md`, whose §0 rules bind regardless of what a step says. And nothing in this
corpus is a to-do list for a human: the to-do list is #3 through #47.
