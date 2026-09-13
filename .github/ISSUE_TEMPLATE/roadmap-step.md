---
name: Roadmap step
about: One ordered step of the mausCode roadmap, written so the implementer never has to reopen the session that produced it
title: "NN · Imperative sentence naming the outcome"
labels: roadmap
assignees: ""
---

<!--
How to use this template. Delete this comment before filing.

The rule behind the shape: an issue is complete when a person who has never seen this
codebase can implement it, verify it and roll it back without asking a question that the
issue could have answered. Everything below is required except the sections marked
"only if". A section you cannot fill is itself information: write "unknown" and name
what you would have measured.

Two rules decide whether this issue is worth filing at all.

1. Every path, line, count and flag in section 3 must have been opened or run by the
   author. Write the level for each claim. Never cite a file you did not read.
2. Section 5 exists because most of this repo's near-misses were features that already
   exist under another name. If you skip it, the issue gets re-litigated in review.

Levels used throughout: E0 intent only, E1 static read of the code, E2 consumer or test
trace, E3 a command run against this tree, E4 the app run locally, E5 reproduced on the
target platform with real user state.
-->

## 0. Meta

| Field | Value |
| --- | --- |
| Step | NN of TT in `.dump/app/plans/2026-09-13-mauscode-roadmap.md` |
| Wave or phase | W0-W14 or P0-P8 as recorded in the plan |
| Area | main, renderer, shared, runtime, db, ci, docs, branding |
| Risk | critical, high, medium, low, from `FULL-REVIEW.md` §3.2 |
| Depends on | issue numbers, or "nothing" |
| Blocks | issue numbers |
| Human decision needed | no, or the exact question |
| Estimate | small (under half a day), medium (one day), large (two to four days) |

## 1. Outcome

One paragraph. Name the user-visible end state, not the refactor. A reader who stops here
should be able to tell whether the work is done.

## 2. Why it matters

What breaks, degrades or stays impossible today. Name the affected flow and how often a
user hits it. State the consequence as a mechanism, not an adjective.

## 3. Evidence

Measured anchors, each with a level. A row with no path is a guess, so mark it as one.

| Fact | Path | Line | Level | Measured |
| --- | --- | --- | --- | --- |
| | | | E1 | 2026-MM-DD at SHA |

## 4. Read first

Ordered list of documents to open before any edit, with the one line each is for. Always
include `AGENTS.md`. Then the relevant parts of `FULL-REVIEW.md`,
`docs/backend-porting-recipe.md` for provider work, `docs/design-system-baseline.md` for
interface work, and the `.dump` research or decision file that produced this step.

## 5. What already exists

Prior art inside this repo and upstream, and why it is not already the answer. Include the
nearest dead or unused code, because adopting it is usually cheaper than writing new code.

## 6. Implementation plan

Numbered steps in commit order. Each step names the files, the shape of the change, and
the gate that proves it. One step should be one reviewable commit. Note where an existing
helper must be reused instead of duplicated.

## 7. Contracts this changes

Only if the step changes anything observable by a caller, a renderer, a provider CLI or a
user database.

| Contract | Before | After | Consumers to update | Migration |
| --- | --- | --- | --- | --- |

## 8. Boundaries

### Always

Rules that hold no matter what the implementation turns out to be.

### Ask first

Anything that changes what the agent may reach, run, send or remember. Put approvals,
sandbox, egress, credential handling, update feeds and packaging trust here.

### Never

The forbidden shapes for this step. Name the exact pattern, not the value, so it can be
checked in review.

## 9. Tests

List the tests to add, and for each one what a pass proves. A behavioural fix needs a
regression test that fails on the current tree, so say how to see it fail first. Mock
peers and binary-free lifecycle tests are the standard for provider work.

## 10. Acceptance criteria

Observable statements with concrete inputs and expected outputs, each checkable by a listed
command or one manual scenario. No criterion may read "works correctly".

- [ ]
- [ ]

## 11. Verification

The exact commands, copied from `AGENTS.md` and the CI jobs, with the expected result of
each. State plainly which of them the author could not run and why, using the gate names in
`CONTRIBUTING.md`.

```sh
bun x biome check .            # 0 findings
npm run typecheck              # 0 errors
npm run test                   # all green
```

## 12. Benchmark record

Required for any step touching startup, memory, render cost, file weight, turn latency or
bundle size. Record the baseline command, the baseline number, the after number and the
environment, in a file under `.dump/app/benchmarks/` named
`YYYY-MM-DD-<slug>.md`, and link it from the PR. A perf claim with no measurement is a
review finding.

## 13. Rollback

How to undo the change safely, including what happens to data written by the new code. For
schema work, name the forward-only migration or state why a revert is safe.

## 14. Out of scope

Adjacent work that must not be folded in here, each with the step that owns it.

## 15. Handoff notes

Decisions the implementer must record back into `.dump` and where, plus anything a later
step will need from this one. Finish by writing or updating the `.dump` file for this step;
an issue closed with no record is a step that has to be re-derived.
