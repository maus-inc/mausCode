# Second Brain - CI

Owner: CI agent (branch arena/01a08de3-mauscode). Updated: 2026-09-11, run 34551940631 = ALL GREEN.
Amended 2026-09-14 by step 02 (branch arena/01a09f6e-mauscode): typecheck baseline facts corrected, tsgo wired as the second typecheck gate.
Amended 2026-09-15 by step 04 (branch arena/01a0a08a-mauscode): the lint gate's base resolution fixed after a force push crashed it, then hardened against SonarCloud jssecurity:S8705; the secrets job now publishes its findings to the step summary. Facts below.

## Current state

**Phase 1 done and validated on CI.** Seven jobs pass end-to-end:
quality (lint+test+typecheck), build ×3 (ubuntu/windows/macos),
package ×2 unsigned (ubuntu/macos), security (gitleaks CLI, audit ratchet).

Commits (ownership): initial CI + fixes (me), rebrand+docs+version (human-forwarded),
lint gate hardening + format sweep bec0263/66a090b (me).

## Where things live

- `research/repository-infrastructure-audit.md` — full baseline (read first).
- `audits/upstream-infrastructure-provenance.md` — identity/provenance map.
- `audits/bun-audit-2026-09-11.txt` — raw 229-advisory baseline.
- `plans/initial-ci-plan.md` — phases 1–4 + decisions + ratchet targets.
- `decisions/2026-09-11-lint-gate-and-format-sweep.md` — lint ratchet rationale
  + biome 2.5 gotchas.

## Facts that bite (do NOT relearn the hard way)

- Renderer `vite build` needs ≥4 GB Node heap: OOM at 2 GB default (mermaid+
  monaco+shiki static graph). CI sets `NODE_OPTIONS=--max-old-space-size=4096`.
- tsc exits status 2 (not 1) on error output in this repo's TS 5.9.3; the
  typecheck baseline `.github/ci-baselines/typecheck.txt` is empty as of the
  2026-09-14 measurement, so zero errors is the gate, and `tsgo --noEmit`
  reports zero errors on the same tree as CI's second typecheck gate.
- `bun audit --json` exits 1 when advisories exist; output still parses.
- `main` is an ancestor of `arena/01a097c4-mauscode`, so a merge base exists
  upstream (`compare/arena/01a097c4-mauscode...main` reports `behind`).
  Corrected 2026-09-15: earlier text here called `main` and `arena/*`
  independent git roots, which was a shallow-clone artifact of the arena
  sandbox, 7 commits deep. Keep the two-dot fallback anyway, for shallow clones
  and genuinely unrelated history.
- A force push orphans the previous head, and a push event passes that head as
  `LINT_BASE`, so the gate must tolerate a base ref the clone cannot resolve.
  It did not until 2026-09-15, when quality died at the lint step on run
  34865816781 while the same commit's PR run passed; `scripts/ci/lint-changed.mjs`
  now falls back to `origin/main` and then to the whole tree. Repro without CI:
  `LINT_BASE=<orphaned-sha> node scripts/ci/lint-changed.mjs`.
- gitleaks-action v2 = paid license for org-owned repos; use CLI pinned w/
  sha256 (v8.30.1, verified in the security job). Since 2026-09-15 the step
  writes a redacted rule/file/line table to `$GITHUB_STEP_SUMMARY`, so a red
  secrets job can be read through the API with
  `gh api repos/maus-inc/mausCode/check-runs/<id> --jq .output.summary`; the
  check-run annotation itself carries only the exit code.
- SonarCloud `jssecurity:S8705` (issue `AaClMoDr11SIv2-9SZIh`) flagged
  `lint-changed.mjs` for passing `LINT_BASE` into git's argument list. Git is
  now called with constant args: a supplied base is matched against
  `git rev-list --all` output and the diffs use the sha git printed, with
  `--end-of-options` on the refs. Do not re-introduce an env or argv value as
  an argument to git; `execFileSync` counts the whole argument list as a sink.
- api.github.com anonymous limit 60/hr/IP is hit on shared macOS runners →
  pass `GITHUB_TOKEN` to anything touching the API (codex/claude downloaders).
- GH job logs unreachable from the arena sandbox (Azure blob host blocked);
  use `gh run view` (jobs) + job HTML annotations via fetch_page to find the
  failing step.
- Arena sandbox (Debian 12, 3.9 GB) blocks: electronjs.org, npmmirror, bun.sh,
  storage.googleapis.com, Azure GH log hosts; TLS-intercept proxy breaks
  `got`/`node-gyp`. Never put sandbox workarounds in committed config.
- better-sqlite3/node-pty need electron-rebuild vs Electron headers → quality/
  build jobs install with `--ignore-scripts`; only the package job does the
  full install (native rebuild) + binary downloads + electron-builder.
- Version reset to **0.1.0** by human decision D6 (supersedes earlier
  "keep 0.0.72" note in provenance audit).
- Product identity decided and now canonical in package.json:
  name `mauscode-desktop`, appId `dev.mausinc.mauscode`, productName
  `mausCode`, publish → GitHub Releases (maus-inc/mausCode).

## Next up (phase order)

1. Release workflow (phase 3): manual dispatch, unsigned first, GH Releases
   with SHA256SUMS + electron-updater manifests.
2. Benchmark infra (phase 2): build-time/RSS harness, renderer bundle-size
   budget, main-process micro benches (db migrate, git status, data-batcher).
3. Ratchet promotions when domains clean up: biome warn→error per rule (list in
   biome.json); audit gate critical→high. Typecheck already runs as a hard
   zero-error gate; its baseline was empty at the 2026-09-14 measurement.
4. JCode vendoring when runtime lands: pin + checksum verify per the
   download-script pattern; upstream perf baselines recorded in audit §7.

## Human questions pending (ask once, when release channels decided)

Release channels/stability policy, Apple Developer account for signing,
product domain (mauscode.dev?) for update feeds. Version policy answered (0.1.0).
