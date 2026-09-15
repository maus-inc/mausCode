## What

<!-- One sentence. What the change does, what it fixes, what it touches. Written for a reader who has never opened this codebase. -->

## Why

<!-- Link the issue or roadmap step. Name what breaks, degrades or stays impossible without this change. Link the `.dump` file that carries the evidence. -->

## Change inventory

<!-- One row per changed contract, per FULL-REVIEW.md §3.2. A file can produce several rows. Delete rows that do not apply. -->

| File | Change type | What a caller, user or provider CLI can observe | Risk |
| --- | --- | --- | --- |

## Boundaries touched

<!-- Tick only what this change actually affects. Anything ticked needs a line in the Evidence section or in a collapsible block. -->

- [ ] Security boundary: approval, sandbox, egress, credential, `shell.openExternal`, CSP, preload bridge, update feed
- [ ] Persisted data: migration, startup recovery, export or wipe path
- [ ] Provider or protocol contract: chunk dialect, harness event mapping, capability manifest
- [ ] Interface: layout, copy, motion, accessibility
- [ ] CI, packaging or supply chain: workflow, script, lockfile, dependency pin, asset weight
- [ ] None of the above

## Evidence

- [ ] Gates run, with results: `bun x biome check .` (0 findings), `npm run typecheck` (0 errors), `npm run test`, `npm run test:node`, `npm run test:contracts`
- [ ] `node scripts/ci/lint-changed.cjs` and `node scripts/ci/typecheck-ratchet.mjs` pass, which is what CI actually runs
- [ ] Behaviour covered by a test that fails on the base commit. Say which one
- [ ] Performance-sensitive path touched, so `.dump/<domain>/benchmarks/YYYY-MM-DD-<slug>.md` records baseline, after value, command and environment
- [ ] Every path, line, count and claim in this description was opened or run by the author, at the level stated
- [ ] No new dependencies, or each addition is justified below with its pin and lockfile proof
- [ ] Docs that described the old behaviour are corrected in this PR

Not run and why:

## Rollback

<!-- How to undo it safely. For schema work, name the forward-only migration or state why a revert is clean. Say what happens to data written by the new code. -->

## Out of scope

<!-- Adjacent work this PR deliberately leaves alone, and the step that owns it. -->

## Notes for reviewers

<!-- Surprises, trade-offs, follow-ups. Put long detail in collapsible blocks, and attach .dump artifacts by path instead of pasting them. -->

<details>
<summary>Detail</summary>

</details>
