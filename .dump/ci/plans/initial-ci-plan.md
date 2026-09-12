# Initial CI Plan — mausCode

Date: 2026-09-11. Owner: CI agent. Status: phase 1 in implementation.
Feeds requirements: constitution §Performance Rule, §Non-negotiable engineering
principles; product thesis ("performance is a product requirement"; benchmarks
CI-visible); audit findings in `../research/repository-infrastructure-audit.md`.

## Design constraints discovered

1. Repo is single-package bun/Electron. No Rust/Tauri/Turbo today → CI must be
   trivially extensible for a future `runtime/` (JCode) workspace, not rebuilt.
2. Baseline is honestly red (110 tsc errors, renderer OOM <4 GB, 229 audit
   advisories). CI must **ratchet**: block regressions now, block absolute
   failure classes as they are fixed — never fake-green.
3. Sandbox network/RAM limits measured and documented; CI targets GitHub-hosted
   runners (7 GB RAM, unrestricted egress).
4. Product release channel/signing policy is undecided (human-owned decision).
   Therefore: no signing infra, no Apple creds, no R2/CDN; artifacts are
   unsigned and published to GitHub Releases with checksums. This is also the
   correct open-source default.

## Phase 1 — foundation (this implementation pass)

- [x] Fix `ts:check` missing dependency (`@typescript/native-preview` pinned exact).
- [ ] `.github/workflows/ci.yml` on PR + push to main + dispatch:
  - `install` (bun, frozen lockfile, cache) →
  - `typecheck` (`tsc --noEmit`) executed through a baseline-ratchet script
    (fails on NEW errors or rising count; passes when count ≤ recorded baseline):
    `scripts/ci/typecheck-ratchet.mjs` + `.github/ci-baselines/typecheck.txt`.
  - `lint` Biome `biome ci --since=<base>` — changed files only, no repo-wide
    reformat; formatter enabled, linter error-gated only for new/changed code.
  - `unit` vitest run (new test infra; initial coverage: security-sensitive pure
    modules — git path validation, terminal data-batcher, git status parser).
  - `build` matrix (ubuntu/macos/windows): full `electron-vite build` with
    `NODE_OPTIONS=--max-old-space-size=4096`; artifact = `out/` minutes-cheap
    check that cross-platform bundling stays green.
  - `package` (ubuntu, macos): `electron-builder --dir` unsigned — proves the
    packaging graph incl. native modules (better-sqlite3, node-pty rebuild).
  - `security`: gitleaks + `bun audit` baseline-ratchet for criticals
    (same mechanism as typecheck) + dependency-review-action on PRs.
- [ ] Lockfile hygiene: delete stale binary `bun.lockb` (superseded by `bun.lock`,
  bun ≥1.2 format), gate CI on frozen-lockfile purity.
- [ ] package.json metadata rebrand per provenance audit; publish target →
  GitHub releases; remove dead `release`/`dist:upload`/`sync:public` scripts.
- [ ] Delete `scripts/sync-to-public.sh`; fix `generate-update-manifest.mjs`
  artifact naming.
- [ ] `.github/`: dependabot (bun, actions), CODEOWNERS-lite, PR template.
- [ ] `.gitignore` audit: add coverage, benchmark output, `.wrangler`.

## Phase 2 — performance regression infra (design lands here, harness next pass)

Benchmarks must be realistic, deterministic, and CI-diffable (JSON summary +
history in `.dump/ci/benchmarks/`):
1. **Build benchmarks**: per-target build time + peak RSS (renderer/main/preload)
   via a wrapper script; baseline from this audit's numbers.
2. **Main-process runtime benchmarks** (headless, no GUI): DB init + migration
   time, git status/diff on synthetic repo fixtures, terminal data-batcher
   throughput, trpc router cold init. These exercise product-relevant hot paths
   the constitution names (session creation, filesystem responsiveness, event
   throughput) without needing a display.
3. **Renderer bundle budget**: fail if `out/renderer` chunks grow beyond recorded
   bytes-per-chunk baseline; directly counters the monaco/mermaid bloat that
   OOMs builds at 2 GB.
4. Future: JCode startup/session/memory protocol the moment `runtime/` lands
   (upstream numbers in audit §7 become the contract).

## Phase 3 — release automation (manual-dispatch, unsigned first pass)

`release.yml`: version-bump input → full matrix build (mac x64+arm64, win x64,
linux x64) → `electron-builder` unsigned targets → SHA256SUMS →
`generate-update-manifest` → GitHub Release draft (human promotes → publish).
JCode/runtime binary bundling slots in via the pinned-download script pattern
once the runtime is integrated. Signing/notarization slots in behind
feature-flag secrets only after the human picks channels.

## Phase 4 — repo health ratchets

Raise gates as domains fix debt: typecheck ratchet → hard gate at 0; biome from
changed-files to full tree; audit gate from critical→high; coverage floor
once test infra matures. Track each ratchet in `../decisions/`.

## Decisions taken (engineering, no human needed)

- **tsc for the gate, tsgo for local speed**: tsc 5.9.3 is the resolved compiler
  (110 errors); tsgo-7-dev diverges (114). Gate follows the real compiler.
- **Ratchet over red**: blocking CI on today's typecheck/audit state would make
  every PR fail for pre-existing domain debt — ratchet blocks only regressions
  and new criticals, while the baseline file self-documents the debt.
- **GitHub Releases as distribution**: removes CDN/R2/Wrangler coupling, zero
  secrets, reproducible, and matches OSS positioning; CDN can be re-added as a
  mirror later without pipeline changes.
- **Biome (not ESLint+Prettier)**: one binary, one config file, ~25× faster —
  aligns with the product's performance thesis; zero new runtime deps.
- **vitest**: bun-native speed, zero-config JSX/TS, standard Electron test tool.

## Open questions for the human (single batch, when convenient)

Only one is blocking eventually: **release channels & distribution identity**
(stable/beta channels? product domain for feeds? Apple Developer account for
signing?). Not needed for phase 1–3; ask once, when release prep starts.
