# Second Brain — Rebrand Mission (mausCode)

Mission: rebrand the inherited 1Code codebase into **mausCode** by **maus-inc** — product,
company, terminology, repo identity, package/app metadata, docs, UI text. Not in scope:
agent runtime, new product features. Constraints: Apache-2.0 attribution preserved, history
never falsified, no blind string replacement, exact `mausCode` capitalization, performance
evidence required for any perf claim, no new dependencies.

## Research

- `research/product-identity-audit.md` — full provenance: baseline = `21st-dev/1code` main @
  `9f1bc76` (v0.0.72, Apache-2.0, archived 2026-03-06, critical issue #104); local import
  commit `6b0de32`; working base `47e440b`. JCode (`1jehuang/jcode`, MIT) = designated runtime
  foundation, **not yet vendored** in this repo.
- 7-category taxonomy applied to every occurrence (UPSTREAM ATTRIBUTION KEEP / HISTORICAL
  CONTEXT KEEP-OR-REWRITE / PRODUCT BRANDING REBRAND / COMPANY BRANDING REBRAND / TECHNICAL
  IDENTIFIER REVIEW / LEGAL NOTICE PRESERVE / DEAD REFERENCE REMOVE). Full classification
  table in `research/product-identity-audit.md`.

## Decisions (all six ratified by the human 2026-09-11 — see `decisions/open-decisions.md`)

- **D1 CLI = `mauscode`** — command, `/usr/local/bin/mauscode`, menu items, launcher script.
- **D2 runtime = "mausCode Runtime"** — reserved in `naming-system.md` only; no runtime UI
  exists yet, so nothing user-visible is affected today.
- **D3 legacy = read-only detection** — `~/.21st/worktrees` + `.1code/worktree.json` are
  detected (git-activity/file-tracking keep working for old worktrees), never written or
  migrated.
- **D4 control plane = local-only by default** — `MAIN_VITE_API_URL` /
  `MAIN_VITE_UPDATE_FEED_URL` env vars, empty = disabled. The inherited 21st.dev endpoints
  were removed entirely (update CDN would have served 1Code's release manifests).
- **D5 compatibility agents** — public term for secondary runtime support (Claude Code /
  Codex / OpenCode / Hermes).
- **D6 version = 0.1.0** — human chose the clean-break "first mausCode" framing over
  continuing 1Code's 0.0.72 line. `package.json` = 0.1.0. Semver-safe (0.1.0 > 0.0.72),
  all version reads are dynamic, and no auto-update path exists from 1Code (different
  appId/control plane).

## What was done (by area)

1. **Provenance**: `UPSTREAM.md` (baseline SHA, JCode MIT, what was inherited) + `NOTICE`
   (Apache-2.0 attribution). README/CONTRIBUTING/CLAUDE.md/openspec/.env.example rewritten
   around them. `LICENSE` untouched.
2. **Identity constants**: `src/shared/app-identity.ts` (protocol `mauscode`, dev protocol
   `mauscode-dev`, product name, AppUserModelId, legacy dir name) + `src/shared/worktree-paths.ts`
   (single source of truth for worktree path detection incl. legacy markers).
3. **App metadata**: `package.json` (name/productName/author/homepage/build.appId/protocol/
   NSMicrophoneUsageDescription), HTML titles, macOS/Windows/Linux install paths, OAuth
   client ids, analytics identity.
4. **UI rebrand**: logo asset + component + 6 call sites, sidebar, title bar, settings
   worktree tabs, onboarding, themes (mausCode Dark/Light as defaults with legacy-id mapping),
   dialogs, menus, update banner. See `audits/ui-rebrand-audit.md` for the surface-by-surface
   audit.
5. **Dead reference removed**: `scripts/sync-to-public.sh` (synced private 21st-dev/21st →
   public 21st-dev/1code — old-company release infra, no mausCode equivalent).
6. **Second brain**: `research/`, `decisions/naming-system.md`,
   `decisions/open-decisions.md`, `audits/ui-rebrand-audit.md`, `.dump/global/naming.md`.

## Rejected approaches

- **Auto-replace every `21st`/`1Code` string** — would have broken legacy worktree detection,
  attribution comments, and the `1code` config-format enum.
- **Auto-migrate 1Code data on first launch** (D3-B) — moving live worktrees with uncommitted
  changes is a data-integrity decision needing its own design + tests; deferred, now well-scoped.
- **npm `overrides` to fix the renderer build failure** — the failure was npm/bun.lock
  dependency *drift in this sandbox*, not a code bug; repo stays on bun.lock, no overrides added.
- **Bumping the version on rebrand** — see D6 (later reversed by the human: 0.1.0).

## Visual assets (2026-09-11, human-directed)

Initially deferred the icon set (no design master available). The human then supplied the
official masters in `new mauscode branding/`, and the set was generated (see
`audits/ui-rebrand-audit.md` for exact sources + geometry).

## Branch integration (parallel CI workstream)

`fd80933` ("ci: repository audit, second brain, and phase-1 CI foundation")
landed on this branch from a parallel workstream before my 5 commits were
pushed. Its scope (CI workflows, vitest, biome, scripts/ci ratchets, .dump/ci)
does not overlap my mission, but it touched the same files in 4 places. I
rebased my commits onto it and resolved:

- **package.json** — kept my `name: mauscode-desktop` and `appId:
  dev.mausinc.mauscode` (the other `io.github.maus-inc.mauscode` is not a
  valid reverse-domain: hyphen in a label; and my appId is already wired
  through constants/index/docs). Adopted their GitHub Releases `publish`
  block (our own infra, compatible with the env-gated updater) and their
  removal of the dead `release` script. Their description line claimed a
  "lightweight native runtime" that does not exist in this repo yet — kept
  the accurate one.
- **scripts/{download-codex-binary,generate-update-manifest,patch-electron-dev}.mjs**
  — both workstreams removed the same stale 21st.dev references; union kept.
  Adopted their GitHub-Release manifest instructions (consistent with the
  integrated publish config) and `node:`-prefixed imports.
- **.env.example** — same control-plane comment block from both sides; kept
  the more detailed wording.
- **scripts/sync-to-public.sh** — deleted by both; identical.

## Verification

**Environment recipe** (when bun is unavailable — e.g. sandboxed CI runners):
`ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-audit --no-fund --loglevel=error --legacy-peer-deps --ignore-scripts`
- `--legacy-peer-deps`: zod 3 (project) vs zod 4 (`@anthropic-ai/claude-agent-sdk` peer).
- `--ignore-scripts`: skips better-sqlite3 native build; not needed for typecheck/bundle.
- **npm drift trap (cost us a build cycle):** without bun.lock, npm resolved
  `@pierre/diffs@1.4.1` instead of the pinned 1.0.10 → `@shikijs/themes` lost its
  `./ayu-light` export → renderer build failed. In verification environments only, pin
  `npm i --no-save @pierre/diffs@1.0.10`. Do NOT add npm overrides to the repo — the
  repo builds with bun + bun.lock.

1. **Typecheck** — zero regressions, verified against durable baselines:
   - Integrated tree: **`node scripts/ci/typecheck-ratchet.mjs` passes** — 110 errors ≤
     110 baseline in `.github/ci-baselines/typecheck.txt`. The inherited debt (missing
     credential-manager/credentials modules, auth/oauth.ts, web/server/api/root, chokidar
     typing, SDK option drift) is ratcheted, not hidden.
   - Pre-rebase tree: `tsc --noEmit` output identical to base `47e440b`.
   - **Process rule (this caught 6 real bugs):** after any multi-file extraction, diff
     tsc output against the pre-change baseline before committing. The worktree-paths
     extraction initially produced 6 new errors (removed private wrapper, missing IS_DEV
     import, 4× wrong relative-import depth) — all caught and fixed pre-commit.
2. **Build**: `electron-vite build` — main ✓ (865.79 kB), preload ✓ (11.95 kB). Renderer
   full vite build OOMs in this 3 GB-cgroup sandbox (exit 137 at ~3500 modules) —
   environmental, not code. Proven by two other means:
   - The first renderer failure (`Missing "./ayu-light" specifier in "@shikijs/themes"`) was
     npm dependency drift: npm resolved `@pierre/diffs@1.4.1` (bun.lock pins 1.0.10), whose
     `@pierre/theming` needs a newer `@shikijs/themes`. Pinning `@pierre/diffs@1.0.10`
     (--no-save, sandbox only) fixed it; nested `@shikijs/themes` with `ayu-light` present.
   - esbuild full renderer graph bundle (main.tsx, ~3500 modules, Vite `?worker` imports
     stubbed): **OK, 49.1 MB output** — every import in every changed file resolves.
4. **Tests**: `vitest run` on the integrated tree — **13/13 passed** (2 files: git
   status/numstat parsers, terminal DataBatcher; the first test suite in the repo,
   added by the CI workstream).
3. **Grep sweep** (source, scripts, manifests, docs, env, URLs, app metadata):
   - `21st` → 12 hits, all intentional: legacy `~/.21st/worktrees` detection (4),
     `LEGACY_APP_DATA_DIRNAME = ".21st"`, attribution comment (cli.ts PR #16), two CDN
     warning comments, three "legacy 1Code" code comments, worktree-paths docs.
   - `1code` → 2 hits in src: the config-format enum value + its zod schema (D3).
     Rest: intentional attribution (UPSTREAM/README/CLAUDE.md lines 26/189/231) + .dump.
   - `jcode` → only `UPSTREAM.md` + README origin section (provenance).
   - Wrong-case `MausCode/MAUSCODE` → only JS constant identifiers
     (`MAUSCODE_DARK/LIGHT`), which are technical identifiers.
   - Display strings verified: "mausCode Dark"/"mausCode Light", "About mausCode",
     `mauscode` command strings, `dev.mausinc.mauscode`, `mauscode://`/`mauscode-dev://`.

## Known issues found (inherited, not fixed — out of scope)

- `ts:check` script referenced `tsgo`, which was not in dependencies (dead script in
  base). The CI workstream added `@typescript/native-preview` (tsgo) as a devDependency,
  so `ts:check` should work now. `tsc --noEmit` remains the plain check used here.
- zod 3 (project) vs zod 4 (@anthropic-ai/claude-agent-sdk peer) — bun tolerates, npm needs
  `--legacy-peer-deps`. Worth a deliberate pin decision later.
- Inherited red typecheck baseline (110 ratcheted errors, see
  `.github/ci-baselines/typecheck.txt`: missing modules etc.) — flag for a dedicated
  cleanup pass, not this mission.

## Risks / follow-ups

- **Demo GIFs still 1Code footage** (owner: human): `assets/{worktree,plan-mode,cursor-
  ui}.gif` are screen recordings of the 1Code UI — the old name is baked into the frames,
  so only re-recording fixes them. Marked in `assets/RE-RECORD.md`; re-record on the first
  visually-final release. Not referenced by `src/` yet (staged assets).
- **Installer icon provenance**: app/tray/settings icons were generated from the official
  masters in `new mauscode branding/` (ImageMagick resize + a no-dependency `.icns`
  container script; `scripts/generate-icon.mjs` still can't run here — sharp missing). If
  the masters are ever revised, regenerate from them; keep the tray geometry (1840² @ +200+200,
  r=350 on 2240²) so it matches the 1Code-era tray slot.
- **Control plane absent** — sign-in/changelog/auto-update/automations are inert by design
  until `MAIN_VITE_API_URL` is configured. README states this honestly ("early development").
- **Notarization** — `21st-notarize` keychain unavailable in sandbox; maus-inc must
  re-provision (`mauscode-notarize`) before signed macOS releases. Documented in CLAUDE.md.
- **No runtime yet** — the "mausCode Runtime" (JCode-derived) naming is reserved, not
  shipped; first runtime integration should reuse `naming-system.md` terms.
- Renderer full-build needs a machine with >3 GB (CI) for final artifact verification.
