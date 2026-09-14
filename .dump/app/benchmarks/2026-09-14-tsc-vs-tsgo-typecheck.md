# tsc vs tsgo typecheck measurement (roadmap step 02)

Date: 2026-09-14. Method: both typecheckers ran on the same tree with the same
`tsconfig.json` program (`include: ["src/**/*"]`) and the same installed
dependency set, at commit `c1b3b19` of `arena/01a097c4-mauscode`.

## Environment

Arena sandbox, Linux x64, Node v22.22.3. No bun in this sandbox, so
dependencies were installed with
`npm install --ignore-scripts --legacy-peer-deps --no-package-lock`, the
fallback the `AGENTS.md` verification gate names. Compilers: `typescript`
5.9.3 and `@typescript/native-preview` 7.0.0-dev.20260707.2, both pinned in
`package.json`.

## Results

| Tool | Command | Errors | Exit code | Wall time |
| --- | --- | --- | --- | --- |
| tsc | `npm run typecheck` | 0 | 0 | ~60 s |
| tsgo | `npm run ts:check` | 0 | 0 | ~23 s |

The delta between the two error lists is empty. Neither tool suppresses the
other; both ran with their default flags and no config change.

## Consequence

The step file (`.dump/app/roadmap/02-gate-policy.md`) adds the `ts:check` job
to CI only when the delta is empty or every line of it is explained. The
first case held, so `.github/workflows/ci.yml` now runs `bun run ts:check` in
the `quality` job as a second typecheck gate. `tsc` stays the blocking gate
that owns `.github/ci-baselines/typecheck.txt` as its record.

## History

The 2026-09-11 infrastructure audit measured 110 tsc errors and 114 tsgo
errors on the pre-cleanup tree (`.dump/ci/research/repository-infrastructure-audit.md`).
That debt was fixed by the owning steps, and the baseline shrank to empty.
The stale 110-error claim survived in the `typecheck-ratchet.mjs` header and
in `.dump/ci/second-brain.md` until step 02 corrected both.
