# Repository Infrastructure Audit

Date: 2026-09-11. Branch: `arena/01a08de3-mauscode` at `47e440b`. Auditor: CI agent.
Method: full-file reads of every root config, every file under `scripts/`, main-process
entry points, lockfiles, `git ls-files` (+0 test files found), local baseline runs of
install/build/typecheck against real toolchains in a Debian 12 sandbox, `bun audit`,
upstream research on `1jehuang/jcode` release infra.

## 1. What this repository actually is

- Electron 39.4 desktop app ("1Code" shell), single package, **not** a monorepo.
- No Turborepo. No Tauri. No Rust crates. JCode is **not vendored**; it lives
  upstream at `github.com/1jehuang/jcode` (v0.84.0 as of 2026-09-07) and any
  Rust/JCode CI in this repo is future work.
- Package manager: **bun** (`bun.lock`, 1288 packages resolve). Node ≥20 implied
  by toolchain deps; sandbox used Node 22.22.3 + bun 1.4.2 successfully.
- Build: `electron-vite build` (3 targets: main, preload, renderer).
- Runtime services: Drizzle + better-sqlite3, node-pty, simple-git, trpc-electron,
  bundled Claude Code and Codex binaries downloaded at release time.

## 2. Baseline: what builds, checks, tests, packages today

| Check | Command | Result | Evidence |
|---|---|---|---|
| Dependency install | `bun install` | **Works on normal networks. Fails in restricted sandboxes.** Electron binary fetch via `got` and Electron headers via node-gyp hit TLS/host blocks. Postinstall = `electron-rebuild -f -w better-sqlite3,node-pty` (skipped when `VERCEL` env set). | two attempts, sandbox |
| Main+preload build | `bun run build` | **Passes** (main 865 kB bundle in ~1.7 s, preload 11.95 kB in ~35 ms) | local run |
| Renderer build | `bun run build` (renderer target) | **OOMs at Node default (~2 GB old-space) during `transforming`; needs ≥4 GB heap.** Verified: 2048 MB fails, 2560 MB fails, >3.9 GB unavailable in sandbox so local pass unverifiable. Cause: monaco-editor + mermaid + shiki + streamdown all statically imported into the graph. | 3 failed runs |
| Typecheck | `bun run ts:check` | **Broken out-of-box: `tsgo` not in devDependencies.** After adding `@typescript/native-preview@7.0.0-dev.20260707.2`: **114 errors**. Cross-check `tsc --noEmit` (TS 5.9.3): **110 errors**. Genuine red baseline, not linter noise. Includes dead monorepo import `../../../../web/server/api/root` in `src/renderer/lib/remote-trpc.ts:6`. | runs + saved outputs |
| Lint/format | — | **No config exists.** Mixed tab/space and semicolon styles across files (e.g. `src/main/lib/trpc/routers/external.ts` tabs vs 2-space elsewhere). | inspection |
| Unit tests | — | **Zero test files.** `openspec/project.md`: "[Testing approach not yet established]". | `git ls-files` grep |
| `bun run package*` | electron-builder | **Untested** (requires native rebuild + full renderer build; sandbox-blocked). CI must validate. | — |
| `bun run release` | script chain | **Broken: references `scripts/upload-release-wrangler.sh`, absent from repo.** `dist:upload` references `scripts/upload-release.mjs`, also absent. | inspection vs `scripts/` listing |
| `bun run sync:public` | `sync-to-public.sh` | **Operational but obsolete**: pushes whole tree to `21st-dev/1code` (archived upstream) and creates GitHub releases there. Must be removed/replaced, not rebranded in place. | script read |
| `bun run claude:download` / `codex:download` | node scripts | **Work**: download + **SHA256-verify** bundled CLI binaries from Anthropic/Zed CDNs into `resources/bin/` (gitignored). Good inherited pattern — reuse for JCode. | script read |
| `bun run dist:manifest` | `generate-update-manifest.mjs` | **Stale**: hardcodes `Agents-{version}-*` artifact names while `productName` is `1Code`. Also hardcodes delta-manifest assumptions tied to the 21st CDN layout. | script read |
| `bun run dev` | electron-vite dev | Not runnable headless in sandbox; CI cannot smoke-test GUI. Renderer dev server has **high-severity Vite vulns** (see section 5) — dev-network exposure matters. | — |
| DB migrations | `bun run db:generate` | Present (drizzle-kit). 8 migrations, journal consistent by inspection. | inspection |

## 3. Secrets / external-service dependencies

- Optional by design (`.env.example`): Apple signing creds, Sentry DSN, PostHog keys,
  OpenAI key for voice, `MAIN_VITE_API_URL` (defaults to `https://21st.dev`).
- Release-time services referenced: Cloudflare R2/Wrangler for CDN upload (script
  missing), `cdn.21st.dev` publish URL (`package.json` `build.publish` and
  `src/main/lib/auto-updater.ts:35`), `gh` CLI + SSH push rights to `21st-dev/1code`.
- CI-required secrets for a first working pipeline: **none** (unsigned artifacts,
  GitHub-hosted release). Apple creds only when a signed channel is decided.

## 4. Inherited infrastructure classification

| Component | Purpose | Verdict |
|---|---|---|
| `scripts/download-claude-binary.mjs`, `download-codex-binary.mjs` | Fetch+verify agent binaries per platform | **KEEP + GENERALIZE** — template for pinned JCode binary acquisition |
| `scripts/generate-update-manifest.mjs` | electron-updater `latest-*.yml` manifests incl. SHA512 | **ADAPT** — fix stale `Agents-` naming; derive from `package.json` |
| `scripts/generate-icon.mjs` | Icon pipeline from `build/icon` sources | **KEEP** (needs mausCode icon sources — rebrand dependency) |
| `scripts/patch-electron-dev.mjs` | Dev-mode dock name/icon patch | **KEEP, renamed strings** (dock shows "1Code") |
| `scripts/sync-to-public.sh` | 21st private→public repo sync + releases | **REMOVE** — maus-inc/mausCode is canonical; no such split |
| `scripts/upload-release-(wrangler)` (missing) | R2 CDN upload | **REMOVE references** — publish via GitHub Releases instead |
| `electron-builder.yml` | Signing identity env-var pass-through | **KEEP as-is** (already env-driven, no 21st identity) |
| `electron-shim.js` | Snap/Flatpak shim | **KEEP** |
| Sentry/PostHog wiring (`src/main/lib/analytics.ts`, `.env.example`) | Telemetry | Code is app-domain; **CI treats as optional env-gated**, no secrets in pipeline |
| `cdn.21st.dev` publish target | Update CDN | **REPLACE** → `provider: github` (electron-updater native, no CDN needed) |
| GitHub Actions | CI/CD | **None inherited — build from scratch** |
| `.github/` repo hygiene (CODEOWNERS, templates, dependabot) | PR quality | **None inherited — add minimum useful set** |

## 5. Security findings

- `bun audit`: **229 advisories (3 critical, 95 high, 111 moderate, 20 low)**.
  Full output archived at `.dump/ci/audits/bun-audit-2026-09-11.txt`.
- Criticals of note: `simple-git@3.30.0` **(direct dependency)** blockUnsafeOperationsPlugin
  bypass → RCE, fixed ≥3.32.3; protobufjs RCE; node-tar decompression DoS.
- `vite≤6.4.1` dev-server arbitrary file read via WebSocket + `server.fs.deny`
  bypass (high) — affects `bun run dev` users; note we resolved 6.4.1 while
  `vite@6.4.2+` exists.
- No secrets committed (`.env*` only carries placeholders; gitleaks-style scan to
  be enforced in CI).
- `postinstall` runs `electron-rebuild` on every install: heavy but standard for
  Electron native ABI. `bun install --ignore-scripts` bypasses for fast CI jobs
  where native modules aren't exercised.

## 6. Performance/build findings (baseline numbers)

- Main bundle: 865.32 kB, ~1.7 s. Preload: 11.95 kB, ~35 ms.
- Renderer build: **>2.5 GB heap requirement** — hot spot for CI time and dev
  machines. Root-cause candidates (app domain, recorded here): full monaco,
  full mermaid, shiki package graph statically linked; no chunk/code-splitting
  config in `electron.vite.config.ts`; no lazy `import()` for viewers.
- `tsc --noEmit`: ~35 s cold. tsgo: ~9 s. Both red (110/114).
- bun install (warm registry, sandbox): resolution ~1.4 s after cache; cold full
  download minutes — dominated by Electron binary ~110 MB.
- These become the first entries in `.dump/ci/benchmarks/` when the benchmark
  harness lands (plan doc, phase 2).

## 7. Upstream JCode infra (research, for future vendoring)

- Releases on GitHub Releases per tag (e.g. `chore(release): v0.84.0`),
  assets per platform; install script `jcode.sh/install`.
- Upstream benchmarks (README, reproducible methodology): RAM 27.8 MB single
  session / ~10 MB per added session (local embedding off); time-to-first-frame
  14 ms vs OpenCode 1036 ms / Claude Code 3437 ms. **These are the numbers
  mausCode inherits and must not regress; treat as baseline-contract values.**
- JCode baseline pin to be recorded in `UPSTREAM.md` when vendoring starts
  (product checklist item 1 — cross-domain, flagged to app/runtime owner implicitly
  via this artifact).

## 8. Identity-in-infrastructure findings (rebrand slice owned by CI)

See `upstream-infrastructure-provenance.md` for per-location action. Summary:
`package.json` name/description/author/homepage/appId/productName/protocol/`publish.url`;
`scripts/*` 21st references; `.env.example` 21st API URL/Discord; `CLAUDE.md`/
`CONTRIBUTING.md` hosted-service tables; `sync-to-public.sh` (removal);
~33 src files with 21st/1code strings — **app/rebrand domain, not touched here**,
except release-infra coupling (`auto-updater.ts` CDN URL) which needs a coordinated
change with the publish target.

## 9. Sandbox-vs-CI environment delta (do not copy sandbox workarounds into CI)

- Sandbox: TLS-intercepting proxy; electronjs.org, npmmirror, bun.sh blocked;
  3.9 GB RAM; no display. Used `NODE_TLS_REJECT_UNAUTHORIZED=0` **locally only**,
  plus `--ignore-scripts` where native rebuild was out of scope.
- CI (GitHub-hosted) has none of these limits. Every sandbox workaround stays
  out of committed config.
