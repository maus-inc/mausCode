# Product Identity Audit

**Agent:** MausAgent (rebrand / identity domain)
**Date:** 2026-09-11
**Base commit:** `47e440b` (mausCode `init` branch; tree = 1Code v0.0.72 + `.dump` workspace + branding assets)
**Upstream provenance anchor:** `main` @ `9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e` "Release v0.0.72" — the verbatim final commit of the archived `21st-dev/1code` repository (Apache-2.0). Verified: SHA matches `21st-dev/1code` `main` HEAD; package version `0.0.72` matches.

Method: exhaustive `grep -rniE '21st|1code|twentyfirst'` over the tree (excluding `node_modules`, lockfiles, and the historical chat-context document), every hit read in context and classified. No automated blind replacement was used; each occurrence was classified first.

## Classification legend

| Class | Action |
|---|---|
| UPSTREAM ATTRIBUTION | Keep, verbatim, in provenance/legal docs only |
| PRODUCT BRANDING | Rebrand to mausCode |
| COMPANY BRANDING | Rebrand to maus-inc |
| LEGAL NOTICE | Preserve (Apache-2.0); rewrite only mausCode's own new copyright lines |
| TECHNICAL IDENTIFIER | Reviewed; rebranded only where it is a fresh-product identifier (no legacy users); legacy-compatible behavior preserved where users may have old data |
| DEAD REFERENCE | Removed or replaced at the root (was pointing at 21st infrastructure that must not serve mausCode) |
| HISTORICAL CONTEXT | Kept in the canonical history document and provenance docs |

## 1. Package & application metadata — `package.json`

| Location | Value | Class | Action taken |
|---|---|---|---|
| `name` | `21st-desktop` | TECHNICAL (npm name, private package) | Rebranded → `mauscode-desktop` (fresh product; name is internal, zero external consumers) |
| `description` | `1Code - UI for parallel work...` | PRODUCT BRANDING | → `mausCode - UI for parallel work with AI agents` |
| `homepage` | `https://21st.dev` | COMPANY BRANDING / DEAD URL | → `https://github.com/maus-inc/mausCode` (no mausCode marketing site exists; do not point at the old company) |
| `author` | `21st.dev` / `support@21st.dev` | COMPANY BRANDING | → `maus-inc` (no public support channel yet — email omitted rather than invented) |
| `build.appId` | `dev.21st.agents` | TECHNICAL (reverse-domain app id) | → `dev.mausinc.mauscode`. Fresh product: no existing installs to migrate, so the id changes. `dev.` prefix follows the inherited convention; domain confirmed 2026-09-11: local-only, env-configured (open-decisions.md D4, resolved A) |
| `build.productName` | `1Code` | PRODUCT BRANDING | → `mausCode` (drives window title, About panel, installer name, macOS bundle name) |
| `build.protocols` | name `1Code`, scheme `twentyfirst-agents` | TECHNICAL + BRANDING | → name `mausCode`, scheme `mauscode` (URL schemes are lowercase per RFC 3986). Dev scheme `mauscode-dev` mirrors the inherited dev/prod split |
| `mac.extendInfo.NSMicrophoneUsageDescription` | `1Code needs microphone...` | PRODUCT BRANDING (user-visible in OS permission dialog) | → `mausCode needs microphone access for voice dictation` |
| `build.publish.url` | `https://cdn.21st.dev/releases/desktop` | DEAD REFERENCE (unsafe) | **Removed.** electron-updater would have fetched 1Code's release manifests — a foreign company's update channel. Replaced by an env-gated feed (`MAIN_VITE_UPDATE_FEED_URL`); auto-update is a no-op until mausCode has its own CDN (open-decisions.md D4, resolved A 2026-09-11) |
| `scripts.sync:public` | → `sync-to-public.sh` | DEAD REFERENCE (21st's private→public repo sync) | Removed (script deleted; it syncs `21st-dev/21st` → `21st-dev/1code`) |
| `scripts.dist:upload` | → `scripts/upload-release.mjs` | DEAD REFERENCE (file does not exist) | Removed |
| `scripts.release` / `release:dev` | invokes `scripts/upload-release-wrangler.sh` | DEAD REFERENCE (file does not exist) | Trailing upload step removed; scripts now end at `dist:manifest` |

## 2. Main process — `src/main/`

| Location | Value | Class | Action taken |
|---|---|---|---|
| `index.ts` `PROTOCOL` | `twentyfirst-agents` / `-dev` | TECHNICAL | → `mauscode` / `mauscode-dev`; moved to `constants.ts` (was duplicated in `index.ts` and `lib/trpc/routers/debug.ts` — DRY) |
| `index.ts` dev userData dir | `Agents Dev` | PRODUCT BRANDING (old "21st Agents" app name) | → `mausCode Dev` (dev/prod data isolation preserved) |
| `index.ts` `getBaseUrl()` (×2) / `getAppUrl()` | `https://21st.dev` / `https://21st.dev/agents` | DEAD REFERENCE (21st service assumption) | Root-cause fix: single config point in `lib/config.ts` — `MAIN_VITE_API_URL` env override, **no hardcoded default**. Empty base = local-only mode (the product's intended default state until the mausCode control plane ships). No more scattered 21st.dev literals |
| `index.ts` auth callback page titles | `1Code - Authentication`, `1Code - MCP Authentication` | PRODUCT BRANDING | → `mausCode - ...` |
| `index.ts` `setAppUserModelId` | `dev.21st.1code.dev` / `dev.21st.1code` | TECHNICAL | → `dev.mausinc.mauscode.dev` / `dev.mausinc.mauscode` |
| `index.ts` About panel | `applicationName: "1Code"`, `copyright: "Copyright © 2026 21st.dev"` | LEGAL (rewrite mausCode's own line) | → `applicationName: "mausCode"`, `copyright: "Copyright © 2026 maus-inc"`. Upstream attribution is NOT claimed as mausCode's — it lives in `NOTICE` / `UPSTREAM.md` (Apache-2.0 §4(c)) |
| `index.ts` menu | `About 1Code`; `Install '1code' Command...` + dialogs (×4) | PRODUCT BRANDING + command name | → `About mausCode`; `'mauscode'` (confirmed 2026-09-11 — open-decisions.md D1, resolved A) |
| `index.ts` `shell.openExternal("https://21st.dev")` (About → homepage) | DEAD REFERENCE | → `https://github.com/maus-inc/mausCode` |
| `windows/main.ts` titles (×3) | `1Code`, `1Code (n)` | PRODUCT BRANDING | → `mausCode` |
| `windows/main.ts` `validateSender` trusted hosts | `["21st.dev", "localhost", "127.0.0.1"]` | DEAD REFERENCE | Root-cause fix: trusted hosts are now **derived from the configured API base URL** (its hostname + subdomains) + `localhost`/`127.0.0.1`. No hardcoded foreign domain; adding the control plane later is a config change, not a code change |
| `auth-manager.ts` API defaults (×2) | `https://21st.dev` | DEAD REFERENCE | → `lib/config.ts` `getApiUrl()` |
| `auth-manager.ts` device info | `21st Desktop ${version} (...)` | COMPANY BRANDING (sent to backend in exchange payload) | → `mausCode Desktop ${version} (...)` |
| `auth-manager.ts` startAuthFlow | `&protocol=twentyfirst-agents-dev` | TECHNICAL | → `mauscode-dev` via `constants.ts` |
| `lib/config.ts` | `getApiUrl()` defaulted to 21st.dev | DEAD REFERENCE | Now the single source of truth: `MAIN_VITE_API_URL` or empty (local-only) |
| `lib/auto-updater.ts` `CDN_BASE` | `https://cdn.21st.dev/releases/desktop` | DEAD REFERENCE (unsafe) | → `getUpdateFeedUrl()`: `MAIN_VITE_UPDATE_FEED_URL` or empty; updater initializes in a disabled state when empty (no foreign update channel is ever contacted) |
| `lib/analytics.ts` header comment | `PostHog analytics for 1Code Desktop` | PRODUCT BRANDING | → `mausCode Desktop` |
| `lib/cli.ts` (×5) | comments/strings for `1code` command; upstream PR link | PRODUCT BRANDING + TECHNICAL; link = UPSTREAM ATTRIBUTION | → `mauscode`; the `21st-dev/1code` PR #16 attribution comment **kept** (inherited feature credit) |
| `lib/platform/{darwin,linux,windows}.ts` (×13) | CLI `installPath`/`scriptName` `1code`, log strings | TECHNICAL + BRANDING | → `mauscode` (fresh product: no old symlinks to migrate) |
| `lib/terminal/env.ts` | `TERM_PROGRAM: "1Code"` | TECHNICAL (read by user shell scripts) | → `mausCode` |
| `lib/claude-config.ts` (×5) | worktree marker `~/.21st/worktrees/...` | TECHNICAL (user data path) | New location `~/.mauscode/worktrees/`; **legacy `~/.21st/worktrees` still recognized** (detection only) so paths created by 1Code remain resolvable — migration-friendly, no data movement |
| `lib/git/worktree.ts` | `join(homedir(), ".21st", "worktrees")` | TECHNICAL | → `.mauscode` |
| `lib/git/worktree-config.ts` (×7) | project-local config `.1code/worktree.json`, source enum `"1code"` | TECHNICAL (file format) | New format `.mauscode/worktree.json` (source `"mauscode"`); **legacy `.1code/worktree.json` kept as read-only fallback** in detection priority `custom > .mauscode > .cursor > .1code`. Writers only write the new format |
| `lib/trpc/routers/worktree-config.ts` (×2) | zod enum `["cursor","1code"]` | TECHNICAL | → `["mauscode","cursor","1code"]` (legacy value remains valid for detection results) |
| `lib/mcp-auth.ts` (×2) | MCP client name `'21st-desktop'` | TECHNICAL (visible to MCP servers) | → `mauscode-desktop` |
| `lib/oauth.ts` (×3) | MCP OAuth `CLIENT_NAME = '1code'`, fallback `'Codex'` | TECHNICAL (dynamic client registration name) | → `mauscode`; `Codex` fallback **preserved** (some MCP servers allowlist third-party names; mausCode is not yet on those allowlists) |
| `lib/trpc/routers/projects.ts` (×4) | GitHub clone default `~/.21st/repos` | TECHNICAL | → `~/.mauscode/repos` (only affects new clones; existing DB rows keep their stored paths) |
| `lib/trpc/routers/chats.ts` (×2) | hardcoded `https://21st.dev` for commit-message / sub-chat naming APIs | DEAD REFERENCE | → `getApiUrl()`; both call sites already fall back to local heuristics when unauthenticated, so local-only mode degrades gracefully |
| `lib/trpc/routers/voice.ts` (×2) | comments "21st.dev backend" | COMPANY BRANDING | → "mausCode control plane"; code path unchanged (still requires the control plane + auth) |
| `lib/trpc/routers/claude-code.ts` | `"Not authenticated with 21st.dev"` | COMPANY BRANDING (error text) | → `"Not authenticated with the mausCode control plane"` |
| `lib/db/schema/index.ts` | comment `// Reference to 21st.dev user` | HISTORICAL (column is control-plane-agnostic) | Comment → `// Reference to mausCode control-plane user`; **column name unchanged** (schema stability; a new product with no shipped schema has no migration burden, but the column already exists in dev DBs) |
| `lib/trpc/routers/debug.ts` | duplicated `PROTOCOL` const | DRY | → imported from `constants.ts` |

## 3. Renderer — `src/renderer/`

| Location | Value | Class | Action taken |
|---|---|---|---|
| `index.html` `<title>` | `1Code` | PRODUCT BRANDING | → `mausCode` |
| `index.html` CSP `connect-src` | `https://21st.dev https://*.21st.dev` | DEAD REFERENCE | Removed (foreign host); `localhost` + posthog retained. The control-plane host is added to the CSP when the domain is decided (D4) — a dead CSP entry would only mask misconfiguration |
| `index.html` loading logo | inline 21st flag-glyph SVG | PRODUCT BRANDING (visual) | → new mausCode glyph (`/logo-mauscode.png`, 256px palette PNG, 5.3 KB) |
| `login.html` `<title>` + logo | `21st - Login`; inline "21st" wordmark SVG | PRODUCT BRANDING | → `mausCode - Login`; glyph asset + "mausCode" wordmark text |
| `components/ui/logo.tsx` | inline 21st flag-glyph SVG, `aria-label="21st logo"` | PRODUCT BRANDING | → `<img>` of the official mausCode glyph with `dark:invert` (class-based dark mode confirmed in `tailwind.config.js`); `aria-label="mausCode logo"`. Old `fill` prop dropped; call sites using `fill="white"` / `text-muted-foreground` updated (they are dark/muted contexts) |
| `features/agents/ui/agent-preview.tsx` (×2) | inline 21st glyph SVG duplicated (loading + error states) | PRODUCT BRANDING + DRY violation | → `<Logo />` component |
| `features/sidebar/agents-sidebar.tsx` | workspace item label `1Code`; automations link `https://21st.dev/agents/app/automations` | PRODUCT BRANDING / DEAD REFERENCE | → `mausCode`; automations link now built from the configured API base (async; gated — the control-plane feature is unavailable in local-only mode) |
| `components/windows-title-bar.tsx` | `1Code` | PRODUCT BRANDING | → `mausCode` |
| `lib/themes/builtin-themes.ts` (×13) | `TWENTYFIRST_DARK/LIGHT`, ids `21st-dark`/`21st-light`, names `21st Dark/Light`, defaults | TECHNICAL (persisted theme ids) + BRANDING | → `MAUSCODE_DARK/LIGHT`, ids `mauscode-dark`/`mauscode-light`, names `mausCode Dark`/`mausCode Light`. Fresh product: persisted theme ids live in per-install localStorage under the new appId — no legacy users. Color values untouched (pure rename; zero rendering behavior change) |
| `lib/themes/diff-view-highlighter.ts` (×3), `lib/themes/shiki-theme-loader.ts` (×3) | theme-id → github theme maps | TECHNICAL | ids updated to match |
| `lib/atoms/index.ts` | default theme ids; `sessionInfoAtom` storage key `"21st-session-info"`; comment "after 21st.dev sign-in" | TECHNICAL / COMPANY BRANDING | → `mauscode-*` defaults; key → `"mauscode-session-info"`; comment → control plane |
| `lib/atoms/index.ts` + theme consumers | — | — | All consumers read the ids through the same constants — verified no orphaned `21st-*` id strings remain (see review passes) |
| `components/update-banner.tsx`, `lib/hooks/use-just-updated.ts`, `features/agents/components/agents-help-popover.tsx` (×5) | `https://1code.dev/changelog`, `https://1code.dev/agents/changelog`, `signedFetch("https://21st.dev/api/changelog/...")` | DEAD REFERENCE | Changelog links → `https://github.com/maus-inc/mausCode/releases` (honest source until mausCode ships its own changelog); the signed fetch is now relative to the configured API base and skipped in local-only mode |
| `lib/remote-api.ts`, `lib/remote-trpc.ts`, `lib/api-fetch.ts` (×4) | API base fallback `https://21st.dev` | DEAD REFERENCE | → shared `src/shared/app-identity.ts` `DEFAULT_API_BASE_URL` (empty) — single literal, env override applied in main |
| `features/agents/lib/remote-chat-transport.ts` (×2) | same fallback | DEAD REFERENCE | same |
| `features/agents/hooks/use-changed-files-tracking.ts` (×2), `features/agents/ui/agent-tool-registry.tsx` (×2), `features/agents/utils/git-activity.ts` (×2), `features/details-sidebar/sections/info-section.tsx` (×2) | regex `/\.21st\/worktrees\/[^/]+\/[^/]+\/(.+)$/` duplicated ×3 (renderer) + equivalent logic in main (`claude-config.ts`) | TECHNICAL + DRY violation | → new shared helper `src/shared/worktree-paths.ts` (`isWorktreePath`, `parseWorktreeRelativePath`) used by all 4 renderer sites; matches **both** `~/.mauscode/worktrees` and legacy `~/.21st/worktrees` |
| `features/agents/commands/builtin-commands.ts` (×3) | `worktree-setup` prompt instructs the agent to create `.1code/worktree.json` | PRODUCT BRANDING (prompt = product behavior) | → `.mauscode/worktree.json` |
| `components/dialogs/settings-tabs/agents-worktrees-tab.tsx` (×6), `agents-project-worktree-tab.tsx` (×5) | save-target select offering `.1code/worktree.json` | PRODUCT BRANDING + TECHNICAL | → select offers `mausCode (.mauscode/worktree.json)` + `Cursor (.cursor/worktrees.json)`; legacy `.1code` files are still **detected** (source badge shows them) but not writable from the UI |
| `features/agents/ui/preview-url-input.tsx` (×2) | comment example host `sandbox-3000.21st.sh` | HISTORICAL (old sandbox subdomain of the old company) | comment example neutralized (`sandbox-3000.example.com`); parsing logic is host-agnostic and untouched |
| `icons/framework-icons.tsx` (×3) | fallback project icon = 21st flag glyph; comments/aria "21st.dev logo" | PRODUCT BRANDING (visual) | comments/aria → mausCode; **artwork replacement pending** — it is a project-placeholder icon, swapping it is visual-identity work (tracked in second-brain) |
| `lib/analytics.ts` header comment | `1Code Desktop` | PRODUCT BRANDING | → `mausCode Desktop` |
| Sentry/PostHog | — | reviewed | No hardcoded 21st DSNs/keys anywhere; both are env-opt-in (`.env.example` unchanged except the API-URL comment). Confirmed clean |

## 4. Scripts & resources

| Location | Value | Class | Action taken |
|---|---|---|---|
| `scripts/sync-to-public.sh` (whole file) | 21st private→public sync to `21st-dev/1code` | DEAD REFERENCE / out-of-scope infra | **Deleted** (recoverable from git history) |
| `scripts/patch-electron-dev.mjs` (×4) | CFBundleName/DisplayName `1Code` for dev dock | PRODUCT BRANDING | → `mausCode` |
| `scripts/download-codex-binary.mjs` | `USER_AGENT = "21st-desktop-codex-downloader"` | COMPANY BRANDING (technical UA) | → `mauscode-desktop-codex-downloader` |
| `scripts/generate-update-manifest.mjs` | console instructions to upload to `cdn.21st.dev` | DEAD REFERENCE | → generic "your mausCode release CDN" |
| `scripts/generate-icon.mjs` | reads `build/icon.png` (old 1Code icon); imports `sharp` | BROKEN (sharp not in dependencies — script cannot run) + visual identity | **Left as-is** (not broken by this work; fixing it belongs to the icon workstream). Flagged in second-brain |
| `resources/cli/1code` | launcher: `open -a "1Code"` | PRODUCT BRANDING + TECHNICAL | → renamed `resources/cli/mauscode`, `open -a "mausCode"` (platform `scriptName` matches) |

## 5. Documentation

| File | Class | Action taken |
|---|---|---|
| `LICENSE` | LEGAL NOTICE | **Untouched.** Plain Apache-2.0 boilerplate (no 21st copyright header inside the file) |
| `NOTICE` (new) | LEGAL NOTICE (Apache-2.0 §4(d)) | maus-inc copyright for mausCode + upstream attribution to 21st-dev/1code with baseline SHA and link |
| `UPSTREAM.md` (new) | UPSTREAM ATTRIBUTION / HISTORICAL CONTEXT | Provenance: 1Code baseline (SHA, license, archive date, version), JCode foundation reference, the import commit, inherited-code rules (attribution, modified-file notices, known upstream security issue #104) |
| `README.md` (rewritten) | PRODUCT BRANDING + UPSTREAM ATTRIBUTION | mausCode identity, honest feature list (what the inherited code actually does today), "Origin & Attribution" section crediting 1Code/21st.dev, no 1code.dev/21st.dev links |
| `CONTRIBUTING.md` (rewritten) | PRODUCT BRANDING | mausCode, performance principle, open-source vs hosted table (hosted = "mausCode control plane — not yet available"), provenance note |
| `CLAUDE.md` | PRODUCT BRANDING + inherited process | product description → mausCode; release section updated to mausCode naming with TODOs where 21st-specific tooling (notarization profile, CDN) must be re-provisioned by maus-inc; technical content preserved |
| `openspec/project.md` | PRODUCT BRANDING | purpose → mausCode; external-deps line: 21st.dev CDN removed (control plane TBD) |
| `.env.example` | DEAD REFERENCE | API URL comment now documents `MAIN_VITE_API_URL` (control plane, optional) + new `MAIN_VITE_UPDATE_FEED_URL` |
| `new mauscode branding/original chat context leading to creation.md` (×32 hits) | HISTORICAL CONTEXT | **Kept verbatim** — canonical product history; contains 21st.dev/1code references by necessity |
| `bun.lock` / `bun.lockb` | mechanical | regenerated from `package.json` (name change) via `bun install` |

## 6. Identity-relevant binaries with no text hits (pending visual-identity workstream)

| Asset | Status |
|---|---|
| `build/icon.png` / `icon.icns` / `icon.ico` | Old 1Code icon. New app icons must be generated from the mausCode glyph (assets in `new mauscode branding/`). `generate-icon.mjs` needs `sharp` added or rewritten. **Pending** — tracked in second-brain |
| `build/background*.tiff/png`, `build/dmg-background*.png/svg` | DMG/background art inherited from 1Code; must be re-checked for embedded old branding before shipping installers. **Pending** |
| `assets/*.gif` (cursor-ui, plan-mode, worktree) | 1Code-era demo recordings; README now defers to screenshots/GIFs TBD. **Pending** re-recording |
| `build/trayTemplate.png`, `settingsTemplate.png` | Monochrome templates — check for old glyph shape. **Pending** |

## 7. What was deliberately NOT changed

- **Schema/table/column names** (`projects`, `chats`, `sub_chats`, `desktop_user_id`) — data model stability; only comments updated.
- **`AGENTS_PANE_ID` / `AGENTS_TAB_ID` / `AGENTS_WORKSPACE_*`** terminal env vars — generic "agents" terminology, not 1Code branding; renaming would break user shell scripts with no identity benefit.
- **`Codex` fallback client name** in MCP OAuth — functional compatibility behavior, not branding.
- **Legacy detection paths** (`~/.21st/worktrees`, `.1code/worktree.json`) — kept as read-only fallbacks so 1Code-era data keeps resolving (decision D3).
- **Upstream PR attribution** in `cli.ts` (`21st-dev/1code` PR #16) — inherited-feature credit.
- **LICENSE** — untouched.
- **`src/main/constants.ts` port numbers** (21321/21322) — no branding content; dev/prod isolation preserved.

## 8. Root-cause fixes (not string swaps)

1. **21st service assumptions** — every hardcoded `https://21st.dev` default was a "21st service assumption" the product thesis says to rip out. They are now one config point (`getApiUrl()`, env `MAIN_VITE_API_URL`, default empty = local-only mode) plus one updater feed point (`MAIN_VITE_UPDATE_FEED_URL`, default empty = updater off). The app is fully functional without a control plane; pointing it at mausCode's future control plane is a build-time env change, not a code change.
2. **Trusted-host validation** — `validateSender` no longer hardcodes a foreign domain; it derives trusted origins from the configured API base.
3. **Protocol duplication** — deep-link protocol now defined once in `constants.ts`.
4. **Worktree-path parsing** — regex previously duplicated across 4 modules now lives in `src/shared/worktree-paths.ts`.
5. **Inline logo duplication** — the 21st glyph SVG was copy-pasted in 4 places; now one asset + one `Logo` component.
