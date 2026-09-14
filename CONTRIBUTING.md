# Contributing to mausCode

mausCode is a local-first agent workspace by maus-inc. It inherits its product/UI foundation
from the archived [1Code](https://github.com/21st-dev/1code) project, Apache-2.0. See
`UPSTREAM.md` and `NOTICE` for the provenance record.

## Documents that bind your change

`AGENTS.md` is the entry point and is binding. It carries the rules, the facts you would
otherwise relearn, the verification gate list, and the parallel-agent ownership rules.
`FULL-REVIEW.md` is the review protocol, and `REVIEW.md` points to it. Provider work follows
`docs/backend-porting-recipe.md`. Interface work follows `docs/design-system-baseline.md`.

`.dump` is the durable engineering memory of this project. It is not a trash folder, not a
transcript folder and not a scratchpad. Decisions, research, audits, rejected approaches and
baselines live there, written for the reader who never saw the session that produced them.
Read `.dump/<domain>/second-brain.md` before working in that area, and write the record back
in the same change. A claim with a path and a measurement is welcome here; a claim without one
gets checked and then removed.

Issues that propose work follow `.github/ISSUE_TEMPLATE/roadmap-step.md`, which requires
evidence with a measured level, an implementation plan in commit order, boundaries in three
tiers, verifiable acceptance criteria, the exact commands, and what stays out of scope.

## CI gates and baselines

The CI `quality` job runs the typecheck gate as `node scripts/ci/typecheck-ratchet.mjs`,
not as a bare `tsc` call. The script runs `tsc --noEmit`, reduces each error to a
`file|TS####` key, and compares the list against the baseline file.
`.github/ci-baselines/typecheck.txt` is empty today, so zero errors is the gate and any
new type error fails CI. When the error count drops below the baseline, the script
asks for the smaller baseline to be committed. `npm run typecheck` runs the same
`tsc --noEmit` locally. The `quality` job also runs `npm run ts:check`
(`tsgo --noEmit` from the pinned `@typescript/native-preview` package) as a second
typecheck gate, and `tsc` owns the baseline record.

The `security` job runs the same shape of gate for dependencies.
`node scripts/ci/audit-ratchet.mjs` compares critical advisories from `bun audit`
against `.github/ci-baselines/audit-critical.txt`, where each row exempts one named
advisory.

A baseline row is an exemption, and it is the cheapest way to make a regression
invisible. A row may only be added by a PR that links a tracking issue, and the PR
description must name what the row excuses, the human-readable error text for a
typecheck row or the advisory and the reason it stays for an audit row. The row itself
must use the exact format the ratchets read: `relative/path.ts|TS####` in the
typecheck baseline and `package|advisory URL` in the audit baseline. Never add a row
for a diagnostic the author did not want to fix, and never add a row in the same PR as
the regression it excuses. Deleting rows and committing a smaller baseline is always
welcome.

## Building from Source

Prerequisites: Bun, Python 3.11 (with setuptools), Xcode Command Line Tools (macOS).

```bash
bun install
bun run dev          # Development with hot reload
bun run build        # Production build
bun run package:mac  # Create distributable (also: package:win, package:linux)
```

Agent binaries are required for agent functionality:

```bash
bun run claude:download
bun run codex:download
```

## Performance rule

mausCode's product claim is a fast, light agent workspace. No change may materially degrade
runtime performance, memory usage, startup time, rendering performance, or existing UI
behavior without a benchmark and a justification recorded in `.dump/<domain>/`.

- Establish a baseline before changing performance-sensitive code
- Benchmark after the change; document the delta
- Prefer root-cause fixes over patches; keep the UI↔backend hot path thin

## Local-only mode

The app runs without any hosted service. When `MAIN_VITE_API_URL` is unset, sign-in, hosted
changelog and auto-updates are unavailable, and every local feature still works. Do not
reintroduce hardcoded third-party service endpoints. Control-plane and update-feed URLs are
build-time configuration, recorded in `.env.example`.

## Analytics & Telemetry

Analytics (PostHog) and error tracking (Sentry) are **disabled by default** in open-source
builds. They only activate if you set the corresponding environment variables in
`.env.local` (see `.env.example`). Never log secrets, and never send project contents.

## Provenance hygiene

When touching inherited code:

- Preserve upstream attribution in `UPSTREAM.md` / `NOTICE` and this file
- Do not claim upstream authorship as mausCode's
- Legacy 1Code data locations, `~/.21st/worktrees` and `.1code/worktree.json`, are
  **detected read-only**. Keep them resolving and never write to them
- New mausCode terminology follows `.dump/global/naming.md`

## Contributing

1. Read `AGENTS.md`, then `REVIEW.md`. Both are binding, not advisory.
2. Find your step in `.dump/app/plans/2026-09-13-mauscode-roadmap.md`. If the work is not
   there, open an issue with the roadmap template before you write code.
3. Create a branch off the current default branch, one step per branch. Touch only the files
   your step owns.
4. Install with `bun install`, the same command CI runs, and keep `bun.lock` in step with
   `package.json`. Do not commit an `npm` lockfile.
5. Run the gates in the `AGENTS.md` verification section and report each as passed, failed or
   not run. Never describe a gate you did not run as green.
6. Record the outcome in `.dump/<domain>/`: the decision, the measurement, and what was
   rejected with the reason.
7. Open a PR using `PULL_REQUEST_TEMPLATE.md`. Keep the summary short and put the detail in
   collapsible blocks.

## License

Apache 2.0
