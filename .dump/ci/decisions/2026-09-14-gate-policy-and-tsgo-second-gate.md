# Decision: baseline policy written once, tsgo wired as second typecheck gate (2026-09-14)

Roadmap step 02, issue #4. Measurement record:
`.dump/app/benchmarks/2026-09-14-tsc-vs-tsgo-typecheck.md`.

## Problem

Three documents disagreed about the typecheck gate. `docs/backend-porting-recipe.md`
section 9 told readers to run `npx tsc -p tsconfig.json --noEmit`, which is not
what CI runs, so a reader who trusted the recipe got a different answer than CI.
The permission to add a baseline row, the cheapest way to make a regression
invisible, was written down nowhere. `npm run ts:check` (tsgo) existed but ran in
no CI job, and the 2026-09-14 ratification that closed item 11 of
`.dump/global/questions.md` made wiring it part of this step. Two stale claims of
a 110-error baseline also survived, in the `typecheck-ratchet.mjs` header and in
`second-brain.md`, although the baseline file is empty.

## Decisions

1. The baseline policy lives in exactly one place, the "CI gates and baselines"
   section of `CONTRIBUTING.md`. It names the script CI runs, the baseline file,
   the empty-baseline means zero-errors consequence, and the rule for adding a
   row: only a PR with a linked issue may add one, the row must match the format
   the ratchets read (`relative/path.ts|TS####` for typecheck, `package|advisory
   URL` for audit), the PR description names what the row excuses, and rows are
   never added for a diagnostic the author did not want to fix, never in the
   same PR as the regression they excuse.
2. `docs/backend-porting-recipe.md` section 9 links to `CONTRIBUTING.md` instead
   of restating a mechanism. `CLAUDE.md` points at the same section instead of
   carrying its own variant of the rule.
3. `tsgo --noEmit` joined the CI `quality` job as a second typecheck gate after
   the measured delta against `tsc` came back empty. `tsc` stays the blocking
   gate and owns the baseline file as its record. Neither tool was suppressed.
4. The stale 110-error claims were corrected in the script header (separate
   commit, per the step's handoff note) and in `second-brain.md`.

## Consequence

`AGENTS.md`, `CLAUDE.md`, `FULL-REVIEW.md`, the recipe and `CONTRIBUTING.md`
now agree on the gate. A future change that wants a baseline row has a written
bar to meet, and a reviewer can point at one paragraph. The tsgo gate fails CI
on any error it finds, with no baseline of its own.
