# Second Brain - CI

Index for the CI capability. Start here.

## Audits

- `audits/sonarcloud-2026-09-11.md` — the full SonarCloud issue catalog: 1836
  open issues split by quality, severity, language, directory, and rule, with
  the two blocker issues and all 46 security issues identified by file and line.
- `audits/deepsource-2026-09-11.md` — DeepSource category counts, the eight
  `JS-0440` `dangerouslySetInnerHTML` occurrences with a verdict on each, and
  which pages are readable without a session.

## Research

- `research/verification-gaps.md` — what can and cannot be run against this
  repository. Covers the broken `ts:check` script, the 110-error type baseline
  broken down by code, the absent test runner, the npm peer conflict, the
  renderer build failure that reproduces on a clean tree, and how to reach
  SonarCloud and DeepSource from a sandbox.

## Plans

- `plans/remediation-roadmap.md` — the four stages, ordered by what unblocks
  what, with the cheap mechanical maintainability work separated from the
  structural work.

## Current state, 2026-09-11

`npm run ts:check` runs and reports 110 pre-existing errors. `npm test` runs 10
cases and they pass. There is still no `.github/workflows`, so neither is
enforced. Adding CI before the 110 errors are resolved would produce a
permanently red job.
