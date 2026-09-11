# Baseline inventory — mausCode repo at init (2026-09-11)

Commit: `6b0de32c1c0a2015ed67591fb623ac0ca47a4d3b` ("original project init context").
Branch: `arena/01a08de4-mauscode`. Upstream JCode is NOT vendored yet — no
`jcode`/`JCode` references anywhere in `src/` or `package.json`.

## Scale

- `src/`: 539 files, 271 `.ts` files, ~8.4 MB.
- Electron + React 19 + tRPC + Drizzle/SQLite + Tailwind + Radix. Package manager: bun
  (note: sandbox has node v22.22.3, no bun — install or pin expectations later).
- App identity still fully inherited: `name: 21st-desktop`, `appId: dev.21st.agents`,
  `productName: 1Code`, `homepage: https://21st.dev`, `author: 21st.dev`,
  `Copyright © 2026 21st.dev`, protocols `twentyfirst-agents-dev://`.

## 1Code backend module inventory (first pass → KEEP / ADAPT / REPLACE / REMOVE)

Source: `src/main/lib/`, `src/main/lib/trpc/routers/`, `src/main/lib/git/`,
`src/main/lib/terminal/`. Line counts are approximate router sizes.

| Module | Path | Size | Verdict (draft) | Rationale |
|---|---|---|---|---|
| Git core (status/diff/staging/worktrees/watcher/cache/security) | `lib/git/` (~25 files) | large | **KEEP then ADAPT** | Proven, security-hardened paths (`security/`, `path-validation.ts`); runtime must eventually own git, but keep until protocol parity |
| Terminal/PTY (manager/session/port/env/history) | `lib/terminal/` | medium | **ADAPT → REPLACE** | Good product surface; daemon model needs JCode-side PTY, keep manager semantics |
| Files router | `trpc/routers/files.ts` | 511 | **ADAPT** | Straightforward fs ops; becomes protocol surface |
| Projects router | `trpc/routers/projects.ts` | 549 | **ADAPT** | Workspace-adjacent; maps to workspace model |
| Chats/sessions router | `trpc/routers/chats.ts` | 2196 | **ADAPT (heavily)** | Session behavior worth preserving; execution authority moves to JCode |
| Claude router | `trpc/routers/claude.ts` | 3230 | **REPLACE core / KEEP UX patterns** | Execution authority → JCode; streaming/approval/plan-mode UX patterns worth keeping |
| Codex router | `trpc/routers/codex.ts` | 1949 | **ADAPT → compatibility adapter** | Becomes reference implementation of `AgentAdapter` |
| claude-code settings/accounts | `claude-code.ts`, `claude-settings.ts`, `anthropic-accounts.ts` | — | **ADAPT** | Seeds for runtime-level BYOK provider config |
| Commands/skills/plugins/ollama/voice | various routers | — | **KEEP** | Product modules, runtime-agnostic |
| Auth (OAuth, auth-manager/store, mcp-auth) | `lib/auth*`, `lib/oauth.ts` | — | **REIMPLEMENT** | 21st-service-coupled; device-registry auth is a new design |
| Auto-updater | `lib/auto-updater.ts` | — | **REIMPLEMENT** | Points at `cdn.21st.dev`; needs maus-owned channel |
| Analytics/Sentry/PostHog | `lib/analytics.ts`, renderer `lib/analytics.ts` | — | **REMOVE then re-add deliberately** | Needs maus-inc telemetry policy first |
| DB schema (projects/chats/sub_chats) | `lib/db/schema/` | — | **ADAPT** | Sound local-first base; extend toward workspace/device/session-metadata model |
| CLI (`1code` command) | `lib/cli.ts`, platform files | — | **REIMPLEMENT** | Becomes `mauscode` CLI surface |
| Worktree config/naming | `lib/git/worktree*` | — | **KEEP** | Naming/config behavior is good product behavior |

UI (`src/renderer/`, features: agents, automations, changes, details-sidebar,
file-viewer, kanban, layout, mentions, onboarding, settings, sidebar, terminal):
**KEEP as reference implementation.** No redesign before the vertical slice works.

## Known security item (do not inherit blindly)

- `src/main/lib/trpc/routers/claude.ts:1768`: `allowDangerouslySkipPermissions: true`
  in non-plan mode with `permissionMode: "bypassPermissions"`. This matches the
  archived upstream issue #104 pattern flagged in the source doc. Treat the inherited
  permission model as **untrusted until re-audited**. Any JCode protocol approval
  model must be designed fresh, not copied from this call site.

## 21st/1Code coupling points (strip list, non-exhaustive)

- `src/main/index.ts`: API base `https://21st.dev`, renderer URL, about menu,
  `dev.21st.1code` app id, `1code` PATH command install, `shell.openExternal(21st.dev)`.
- `src/main/windows/main.ts`: window title `1Code`, trusted origins `21st.dev`.
- `electron-builder.yml` + `package.json`: appId/productName/artifact names.
- `src/main/lib/config.ts`, `auth-manager.ts`, `oauth.ts`, `mcp-auth.ts`,
  `auto-updater.ts`, `analytics.ts`: service URLs, OAuth, CDN, telemetry.
- `src/renderer/lib/remote-api.ts`, `remote-trpc.ts`, `api-fetch.ts`,
  `features/agents/lib/remote-chat-transport.ts`: hosted-backend assumptions.
- `resources/bin/` (gitignored): downloaded Claude/Codex binaries — release pipeline
  currently depends on `scripts/download-*-binary.mjs`.
- Docs: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `openspec/project.md` all still
  describe 21st/1Code. `LICENSE` is Apache-2.0 (retain + add NOTICE-level attribution
  handling per UPSTREAM policy; never strip upstream attribution).

## Branding assets on hand

`new mauscode branding/`: 5 logo PNGs (black/white/transparent variants) + source doc.
No final wordmark decision recorded yet — that is a human-facing choice.

## Baselines to freeze (UPSTREAM.md)

- [ ] 1Code upstream commit SHA — **not yet recorded** (init commit message does not
  contain it; recover from history/tags if possible, else record init SHA + date +
  archived-state note).
- [ ] JCode upstream commit SHA — **not yet vendored**; freeze at vendor time.
- [ ] Benchmark numbers — none exist yet; `benchmarks/` to be created.
