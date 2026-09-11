# Second Brain - CI

Owner: CI agent (branch arena/01a08de3-mauscode). Updated: 2026-09-11, run #2 pending.

## Current state

**Phase 1 committed** (commits c5ee79d? see git log: initial CI commit + 078f179 fixes).
CI run #1 verified: quality ✓ build×3 ✓ package ubuntu ✓; security ✗ macOS package ✗.
Root causes fixed in 078f179: gitleaks-action org-license (→ pinned CLI v8.30.1 +
sha256), missing GITHUB_TOKEN on macOS rate-limited pool, checkout v5.

## Where things live

- `research/repository-infrastructure-audit.md` — full baseline (read first).
- `audits/upstream-infrastructure-provenance.md` — identity/provenance map + actions.
- `audits/bun-audit-2026-09-11.txt` — raw 229-advisory baseline.
- `plans/initial-ci-plan.md` — phases 1–4 + decisions + ratchet targets.

## Facts that bite (do NOT relearn the hard way)

- Renderer `vite build` needs ≥4 GB Node heap: OOM at 2 GB default (mono->
  mermaid+monaco+shiki static graph). CI sets `NODE_OPTIONS=--max-old-space-size=4096`.
- `bun run ts:check` was dead (tsgo not in devDeps) — now fixed; tsc gate has a
  110-error inherited baseline (`.github/ci-baselines/`), tsgo count differs (114).
- tsc exits status 2 (not 1) on error output in this repo's TS 5.9.3.
- `bun audit --json` also exits 1 when advisories exist; output still parses.
- biome 2.5: `--since` requires `--changed`; empty changed set exits 1 →
  lint-changed.mjs wrapper computes the list incl. uncommitted/untracked.
- biome `linter.rules.recommended` config key deprecated → `preset: "recommended"`.
- gitleaks-action v2 = paid GITLEAKS_LICENSE for org-owned repos; use CLI pinned
  w/ sha256 (pattern verified working in run #2, pending confirmation).
- api.github.com anonymous limit 60/hr/IP is hit on shared macOS runners → pass
  `GITHUB_TOKEN` env to anything touching the API (download-codex uses it).
- GH job logs unreachable from the arena sandbox (Azure blob host blocked);
  use `gh run view` + Checks API + fetch_page on job HTML (annotations section
  shows failing step names).
- Sandbox (Debian 12, 3.9 GB RAM) blocks: electronjs.org, npmmirror, bun.sh,
  storage.googleapis.com, Azure GH log hosts; has TLS-intercept proxy that
  breaks `got`/`node-gyp` clients. Never put sandbox workarounds in CI.
- better-sqlite3/node-pty need electron-rebuild vs Electron headers; full
  `bun install` only works on real networks → CI package job uses plain
  `bun install`, quality/build jobs use `--ignore-scripts`.

## Next up (phase order)

1. Confirm run #2 green (esp. gitleaks CLI + package macOS).
2. Release workflow (phase 3): manual dispatch, unsigned first, GH Releases.
3. Benchmark infra (phase 2): build-time/RSS harness, bundle-size budget on
   out/renderer, main-process micro benches (db migrate, git status, batcher).
4. Ratchets when domains clean up: typecheck → hard gate; lint repo-wide;
   audit gate critical → high (95 known highs documented).
5. JCode vendoring when runtime lands: pin + verify per the download-script
   pattern; upstream perf baselines recorded in audit §7.

## Human questions pending (ask once, when release channels decided)

Release channels/stability policy, Apple Developer account for signing,
product domain (mauscode.dev?) for update feeds. See plans/initial-ci-plan.md.
