# Upstream Infrastructure Provenance (CI / release / packaging slice)

Date: 2026-09-11. Scope: build/release/CI/package metadata/deployment references to
inherited 21st.dev / 1Code identity. Product-string changes inside `src/**` and
docs owned by other domains are listed for handoff, not modified by CI.

Rule applied: keep legal attribution, replace operational identity. Never falsify
provenance.

## 1. Legally protected — DO NOT MODIFY

| Location | What |
|---|---|
| `LICENSE` | Apache-2.0 full text, no copyright line appended in text body — leave untouched. Repo contains no NOTICE file; if one appears later, preserve it. |
| Attribution comments in source (e.g. `src/main/lib/cli.ts:4` "Based on PR #16 by @caffeinum ... github.com/21st-dev/1code/pull/16") | Historical attribution. Keep. |
| `assets/*.gif`, upstream screenshots | Provenance material; replacement is a rebrand-domain decision. |

## 2. Package/build identity — CI owns, change now

| Location | Value (inherited) | Action |
|---|---|---|
| `package.json` `name` | `21st-desktop` | → `mauscode-desktop` (human-side rebrand decision, settled) |
| `package.json` `description` | "1Code - UI for parallel work with AI agents" | → mausCode product description |
| `package.json` `version` | `0.0.72` | → `0.1.0` (human decision D6, 2026-09-11) |
| `package.json` `homepage` | `https://21st.dev` | → `https://github.com/maus-inc/mausCode` (no product domain exists yet) |
| `package.json` `author` | 21st.dev / support@21st.dev | → maus-inc |
| `package.json` `build.appId` | `dev.21st.agents` | → `dev.mausinc.mauscode` (settled in rebrand pass; supersedes my initial `io.github.maus-inc.mauscode`) |
| `package.json` `build.productName` | `1Code` | → `mausCode` |
| `package.json` `build.protocols` | `twentyfirst-agents` scheme | → `mauscode` scheme |
| `package.json` `build.publish.url` | `https://cdn.21st.dev/releases/desktop` | → GitHub provider (`github.com/maus-inc/mausCode`); removes hard CDN dependency |
| `package.json` mac `extendInfo` mic text | "1Code needs microphone access..." | → mausCode |
| `scripts/patch-electron-dev.mjs` | dock name "1Code" | → "mausCode" |
| `scripts/download-codex-binary.mjs:24` | UA `21st-desktop-codex-downloader` | → `mauscode-codex-downloader` |
| `scripts/generate-update-manifest.mjs` | `Agents-{version}-*` filename patterns | rewrite to derive from `productName` + document expected artifacts |
| `scripts/sync-to-public.sh` | pushes to `21st-dev/1code`, releases there | DELETE (obsolete deployment model) |
| `package.json` scripts `release`, `dist:upload`, `sync:public` | reference missing upload scripts | replace with GH-release based flow |
| `.env.example` | `https://21st.dev` API default, 21st Discord | → mausCode-relevant placeholders; mark unresolved hosted-URL items |
| `electron-builder.yml` | apple identity via env | KEEP (already identity-neutral) |

## 3. Operational 21st couplings needing product decisions (tracked, not silently changed)

| Coupling | Where | Why not changed unilaterally |
|---|---|---|
| Auto-update feed `cdn.21st.dev` | `src/main/lib/auto-updater.ts:35` | Product-facing distribution decision (release channel/host). Recorded in plan; flagged to human when channels decided. Default CI stance: releases via GitHub Releases make the CDN optional. |
| OAuth/web API base `https://21st.dev` | `src/main/auth-manager.ts`, `src/renderer/lib/remote-api.ts`, `src/main/lib/oauth.ts` | Backend does not exist for mausCode; app/rebrand domain owns. |
| `twentyfirst-agents-dev://` dev protocol + `Agents Dev` userData dir | `src/main/windows/main.ts`, CLAUDE.md | Changing userData dir orphans existing dev installs — migration behavior is a product decision. |
| Cloudflare R2/Wrangler upload + notarization steps | referenced `scripts/upload-release-wrangler.sh` (absent), `electron-builder.yml` comment | 21st signing infra; maus signing policy undecided (needs Apple account = human). |
| PostHog/Sentry | `src/main/lib/analytics.ts`, `src/renderer/lib/analytics.ts` | Telemetry policy is a product decision; CI keeps it env-gated and out of the pipeline. |

## 4. Handoff list for app/rebrand domains (found while auditing; CI does not touch)

- `src/renderer/lib/remote-trpc.ts:6` dangling monorepo import `../../../../web/server/api/root` — breaks typecheck; dead code from monorepo extraction.
- ~33 `src/**` files with 21st/1code/21st.dev references (grep list in research audit section 8 input).
- `CLAUDE.md`/`CONTRIBUTING.md` hosted-open-source split tables referencing 1code.dev.
- `README.md` full rewrite needed (1code.dev links, Pro subscription copy, assets).
- `openspec/project.md` describes "21st Agents" — should describe mausCode architecture once defined.

## 5. JCode (future runtime) provenance notes

- Upstream: `github.com/1jehuang/jcode`, MIT license — MIT requires keeping its
  copyright notice when vendored; simplest compliance: vendor under `runtime/jcode/`
  (or downloaded pinned binaries) with its LICENSE file intact.
- Upstream is actively developed (v0.84.0, 2026-09-07). Vendor strategy = pinned
  version + checksum verification via a generalized `scripts/download-*-binary.mjs`
  rather than subtree copy, to keep provenance explicit and updates auditable.
