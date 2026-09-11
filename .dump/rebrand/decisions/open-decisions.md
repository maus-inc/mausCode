# User-Facing Decisions (rebrand) — ALL RESOLVED

Decisions that change the **public product**. Each was researched with a recommendation,
presented to the human, and ratified on **2026-09-11**. This file is the durable record of
what was decided and why — future work must follow these choices unless the human reverses one.

**Resolution summary:** D1 `mauscode` · D2 "mausCode Runtime" · D3 read-only legacy
detection · D4 local-only, env-configured control plane · D5 "compatibility agents" ·
D6 version reset to `0.1.0`.

## D1 — CLI command name (⚠ public, user types it forever)

The app-installed terminal launcher is currently `1code`. The rebrand installs it as:

- **A. `mauscode` (recommended)** — matches the product exactly; unambiguous; self-documenting. `mauscode .` opens the current directory.
- B. `maus` — shorter, but a bare company word as a command invites collisions and reads oddly (`maus node`, `maus run` are plausible *future* runtime subcommands, which argues for keeping the command namespace for the runtime later).
- C. Keep `1code` — migration comfort, but ships the old brand as the product's primary command.

**Consequence:** command name, install paths (`/usr/local/bin/...`), menu labels, launcher script name, docs.
**RESOLVED (2026-09-11):** A — `mauscode`. Wired in `src/shared/app-identity.ts`, `resources/cli/`, platform installers, menus, docs.

## D2 — Public name of the native runtime (⚠ public terminology)

mausCode owns a runtime derived and refined from JCode. The public term must make the product read as one coherent thing.

- **A. "mausCode Runtime" (recommended)** — one product, one name. JCode appears only in provenance (`UPSTREAM.md`/`NOTICE`). The performance story is told as mausCode's: "runs on the mausCode Runtime — X MB, Y startup."
- B. "JCode Runtime" — credits the foundation publicly, but sells the upstream project as a separate identity (the exact incoherence the product thesis rejects).
- C. "mausCode/JCode Runtime" — dual brand; clunky in UI.

**Consequence:** future UI (runtime picker, devices screen), docs, releases, benchmark claims.
**RESOLVED (2026-09-11):** A — "mausCode Runtime". Reserved in `naming-system.md`; no runtime UI exists yet, so nothing user-visible is affected today. First runtime integration MUST reuse this term.

## D3 — How much legacy 1Code terminology stays visible (⚠ public behavior for 1Code users)

mausCode can recognize data created by 1Code: `~/.21st/worktrees/` and project files `.1code/worktree.json`.

- **A. Read-only legacy detection (recommended, implemented)** — mausCode *detects* old worktree paths and old config files (so nothing breaks and 1Code-era setups keep working), but writes only the new `.mauscode/` locations. No migration prompts, no automatic file moves.
- B. Auto-migrate on first launch — move `~/.21st/worktrees` → `~/.mauscode/worktrees`, rewrite `.1code/worktree.json` → `.mauscode/worktree.json`. Nicer for switchers; riskier (moving live worktrees with uncommitted changes is a data-integrity decision that deserves its own design + tests).
- C. No legacy awareness — cleanest code; 1Code-era worktree paths stop resolving (git-activity/file-tracking features would misattribute files in old worktrees).

**Consequence:** behavior for anyone switching from 1Code; amount of "legacy" comment code kept.
**RESOLVED (2026-09-11):** A — read-only detection. (B, auto-migration, remains a well-scoped follow-up if ever wanted.)

## D4 — mausCode control-plane domain / endpoints (⚠ public infrastructure)

The inherited app had its hosted features (sign-in, changelog, auto-update CDN, automations, sandbox mode) pointing at `21st.dev` / `cdn.21st.dev` / `1code.dev`. mausCode must **not** point at the old company's services (wrong legally, brand-wise, and unsafe — the update CDN would have served 1Code's manifests). The mausCode control plane does not exist yet, so the rebrand ships **local-only by default**:

- **A. No public domain yet — local-only (recommended, implemented)** — `MAIN_VITE_API_URL` and `MAIN_VITE_UPDATE_FEED_URL` build-time env vars; empty = sign-in/changelog/updates simply unavailable, everything local works. When the control plane ships, set the vars (and the CSP host) — zero code changes.
- B. Reserve a domain now (e.g. `mauscode.dev` / `maus.dev`) and hardcode it — I cannot verify domain availability/ownership from here; provisioning is a maus-inc action.
- C. Ship the control plane as part of this repo immediately — out of scope for the identity workstream.

**Consequence:** which hosts appear in CSP, updater, auth; what users see when they click "Sign in" (today: a clear "control plane not configured" path).
**RESOLVED (2026-09-11):** A — local-only by default; `MAIN_VITE_API_URL` / `MAIN_VITE_UPDATE_FEED_URL` at build time, empty = hosted features off. When the control plane ships, set the vars + CSP host — zero code changes.

## D5 — Product term for external coding agents (⚠ public terminology)

Claude Code / Codex / OpenCode / Hermes are secondary compatibility options in the product model. When the UI needs a group label:

- **A. "Compatibility agents" (recommended)** — precise, matches the architecture (adapter layer), no negative framing.
- B. "External agents" — accurate but neutral/dry.
- C. "Other agents" — simplest, slightly dismissive of products we deliberately support.

**Consequence:** future agent-picker UI grouping.
**RESOLVED (2026-09-11):** A — "compatibility agents". Reserved in `naming-system.md`; no current UI grouping exists, so nothing visible changes today.

## D6 — App version line (minor, ⚠ release policy)

The inherited `package.json` carries `0.0.72` (1Code's version). A new product could restart at `0.1.0`.

- **A. Keep `0.0.72` (was recommended for now)** — no release pipeline exists yet; restarting the line is a release-engineering decision best made with the first real release (and is one line).
- B. Restart at `0.1.0` immediately.

**RESOLVED (2026-09-11):** B — restart at `0.1.0`. The human chose the clean-break "first mausCode" framing. `package.json` version set to `0.1.0`. Safe to jump: 0.1.0 > 0.0.72 in semver (no downgrade signal), version reads are all dynamic (`app.getVersion()`, updater `info.version`), and there is no auto-update path from 1Code to mausCode (different appId/control plane) — the bump only starts mausCode's own release line.
