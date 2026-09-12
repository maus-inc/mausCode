# UI Rebrand Audit — mausCode

Scope: every user-visible surface, not just the logo. Each surface was inspected in source
before changing anything; "rework" means strings/identity that still communicated the old
1Code mental model were rewritten, and working behavior was preserved.

Status legend: **done** — changed in this branch · **done (bug fix)** — file touched for import
correctness after the worktree-paths extraction, no string changes · **owner: human — RE-RECORD**
— human-owned task with a tracking file in the repo · **n/a** — no brand content.

## Surfaces

| Surface | Location | Status | What changed |
|---|---|---|---|
| Logo / brand glyph | `src/renderer/components/ui/logo.tsx`, `src/renderer/assets/logo-mauscode.png` (new, 256px, 5.3 kB) | done | New mausCode glyph; component keeps same props API so all 6 call sites work unchanged |
| Sidebar | `src/renderer/features/sidebar/agents-sidebar.tsx`, `src/renderer/icons/framework-icons.tsx` | done | Sidebar brand mark + wordmark; fallback icon = mausCode logo (was 1Code mark) |
| Navigation / chrome | `src/renderer/components/windows-title-bar.tsx` | done | Title bar wordmark → mausCode |
| Settings | `settings-tabs/agents-project-worktree-tab.tsx`, `agents-worktrees-tab.tsx`, `claude-login-modal.tsx` | done | Worktree config save-target UI: `.mauscode/worktree.json` as first-class option (with Cursor); legacy 1Code file shown as read-only detection, never written |
| Onboarding | `onboarding/anthropic-onboarding-page.tsx`, `api-key-onboarding-page.tsx`, `select-repo-page.tsx` | done | Brand references + `.mauscode/worktree.json` setup instructions in generated prompt text |
| Empty states / preview | `features/agents/ui/agent-preview.tsx`, `preview-url-input.tsx`, `codex-login-content.tsx` | done | Brand text in preview/login panels |
| Command palette / help | `features/agents/commands/builtin-commands.ts`, `agents-help-popover.tsx` | done | Command copy + help text brand terminology |
| Errors / notifications | `components/update-banner.tsx`, `features/details-sidebar/sections/info-section.tsx` | done | Update banner copy; info-section app identity metadata |
| Metadata (app strings) | `src/main/index.ts`, `src/shared/app-identity.ts` | done | "About mausCode" menu, install/uninstall 'mauscode' command menu items + dialogs, AppUserModelId `dev.mausinc.mauscode(.dev)`, `applicationName: "mausCode"`, window titles |
| Title bars (webviews) | MCP auth + OAuth webview HTML | done | `<title>mausCode - Authentication</title>`, `<title>mausCode - MCP Authentication</title>` |
| Menus | `src/main/index.ts` | done | About item, GitHub link → maus-inc/mausCode |
| Dialogs | `claude-login-modal.tsx`, CLI install dialog | done | Login modal branding; CLI install/uninstall detail text references `mauscode` command |
| Tooltips | across changed renderer files | done | Any tooltip string naming the app now says mausCode |
| Themes (user-visible) | `lib/themes/builtin-themes.ts`, `shiki-theme-loader.ts`, `diff-view-highlighter.ts` | done | Default themes renamed `mausCode Dark` / `mausCode Light` (ids `mauscode-dark`/`mauscode-light`), first in list, set as defaults; legacy ids kept in mapping so existing user settings don't break |
| Installers / CLI | `resources/cli/mauscode` (renamed from `resources/cli/1code`), `src/main/lib/cli.ts`, platform installers (darwin/linux/windows) | done | CLI command `mauscode`, install path `/usr/local/bin/mauscode`, macOS `open -a "mausCode"` |
| HTML entry points | `src/renderer/index.html`, `login.html` | done | `<title>mausCode</title>`, logo + wordmark in loading splash; relative asset paths (packaged-file-safe) |
| Analytics identity | `src/main/lib/analytics.ts`, `src/renderer/lib/analytics.ts`, `remote-api.ts`, `remote-trpc.ts`, `atoms/index.ts`, `api-fetch.ts` | done | CLIENT_NAME / product identity = mauscode; control-plane base URL env-gated (empty = local-only) |
| Automations UI | `features/automations/*.tsx` (3 files) | done | Brand strings in automation views (hosted feature, off by default) |
| Documentation | `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `openspec/project.md`, `.env.example` | done | Full rewrites (see second-brain.md) |
| Manifests / app metadata | `package.json` (name, productName, author, homepage, build.appId, build.protocols, NSMicrophoneUsageDescription) | done | `mauscode-desktop` / `mausCode` / `maus-inc` / `dev.mausinc.mauscode` / scheme `mauscode` |
| App icons / DMG backgrounds | `build/icon.{png,icns,ico}`, `build/dmg-background*`, `build/background*`, `build/settingsTemplate*`, `build/trayTemplate*` | done | 1Code bitmaps replaced from official masters (2026-09-11). App icon = `icon-blackbackdropwhitelogotransparentbg` (png/icns/ico size chain). Tray = `logo-whitebackgroundblacklogo` squircled (r=350 @ 1840², +200+200 on 2240² — matches 1Code tray geometry). Settings = generic gear template (12/24px). DMG + window backgrounds: confetti recolored from pastel blue/pink to pale black (SVG `#09090b` fills + raster `fx` desaturation, opacity preserved). |
| Demo GIFs | `assets/{worktree,plan-mode,cursor-ui}.gif` (repo root) | **owner: human — RE-RECORD** | Screen recordings of the 1Code UI; old name is baked into the footage, so a logo/string swap cannot fix them. Marked in `assets/RE-RECORD.md`; re-record on the first visually-final mausCode release. |

## What deliberately was NOT changed

- `LICENSE`, `NOTICE`, `UPSTREAM.md` — legal/provenance (see research/product-identity-audit.md).
- Legacy detection code: `~/.21st/worktrees` + `.1code/worktree.json` are read-only signals
  (decision D3). The string `"1code"` survives in exactly two places — the worktree-config
  source enum and its zod validation — because it identifies a *file format*, not the product.
- Upstream PR credit comment in `src/main/lib/cli.ts` (21st-dev/1code#16) — attribution.
- Two CDN-warning comments in `auto-updater.ts` / `app-identity.ts` — explain why the
  inherited endpoint was removed.

## Verification

- Repo-wide greps (see second-brain.md §Verification): every surviving `21st` / `1code` /
  `jcode` hit is classified in the 7-category taxonomy; none are unclassified brand leakage.
- All user-facing display strings use exact `mausCode` capitalization (uppercase C only).
  The only all-caps occurrences are JS constant identifiers (`MAUSCODE_DARK`) — technical
  identifiers, where case changes would be unsafe.
- Theme id rename kept a legacy-id → new-theme mapping so existing users' saved theme
  preferences resolve (no behavior break).
