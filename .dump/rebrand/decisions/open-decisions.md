# Open Decisions (user-facing)

Decisions that change the **public product**. Each was researched and a recommendation made by MausAgent. Nothing here blocks the rebrand implementation — the implementation uses the recommended value and is a one-line change if the human picks otherwise.

## D1 — CLI command name (⚠ public, user types it forever)

The app-installed terminal launcher is currently `1code`. The rebrand installs it as:

- **A. `mauscode` (recommended)** — matches the product exactly; unambiguous; self-documenting. `mauscode .` opens the current directory.
- B. `maus` — shorter, but a bare company word as a command invites collisions and reads oddly (`maus node`, `maus run` are plausible *future* runtime subcommands, which argues for keeping the command namespace for the runtime later).
- C. Keep `1code` — migration comfort, but ships the old brand as the product's primary command.

**Consequence:** command name, install paths (`/usr/local/bin/...`), menu labels, launcher script name, docs.
**Implemented as:** `mauscode` (option A). Change surface if decided otherwise: `src/shared/app-identity.ts` `CLI_COMMAND`, `resources/cli/`, platform installers, menu strings.

## D2 — Public name of the native runtime (⚠ public terminology)

mausCode owns a runtime derived and refined from JCode. The public term must make the product read as one coherent thing.

- **A. "mausCode Runtime" (recommended)** — one product, one name. JCode appears only in provenance (`UPSTREAM.md`/`NOTICE`). The performance story is told as mausCode's: "runs on the mausCode Runtime — X MB, Y startup."
- B. "JCode Runtime" — credits the foundation publicly, but sells the upstream project as a separate identity (the exact incoherence the product thesis rejects).
- C. "mausCode/JCode Runtime" — dual brand; clunky in UI.

**Consequence:** future UI (runtime picker, devices screen), docs, releases, benchmark claims.
**Implemented as:** reserved terminology in `naming-system.md` only — **no runtime UI exists yet, so nothing user-visible is affected by this choice today.**

## D3 — How much legacy 1Code terminology stays visible (⚠ public behavior for 1Code users)

mausCode can recognize data created by 1Code: `~/.21st/worktrees/` and project files `.1code/worktree.json`.

- **A. Read-only legacy detection (recommended, implemented)** — mausCode *detects* old worktree paths and old config files (so nothing breaks and 1Code-era setups keep working), but writes only the new `.mauscode/` locations. No migration prompts, no automatic file moves.
- B. Auto-migrate on first launch — move `~/.21st/worktrees` → `~/.mauscode/worktrees`, rewrite `.1code/worktree.json` → `.mauscode/worktree.json`. Nicer for switchers; riskier (moving live worktrees with uncommitted changes is a data-integrity decision that deserves its own design + tests).
- C. No legacy awareness — cleanest code; 1Code-era worktree paths stop resolving (git-activity/file-tracking features would misattribute files in old worktrees).

**Consequence:** behavior for anyone switching from 1Code; amount of "legacy" comment code kept.
**Implemented as:** A. (B can be added later as a first-run migration task — it's now well-scoped.)

## D4 — mausCode control-plane domain / endpoints (⚠ public infrastructure)

The inherited app had its hosted features (sign-in, changelog, auto-update CDN, automations, sandbox mode) pointing at `21st.dev` / `cdn.21st.dev` / `1code.dev`. mausCode must **not** point at the old company's services (wrong legally, brand-wise, and unsafe — the update CDN would have served 1Code's manifests). The mausCode control plane does not exist yet, so the rebrand ships **local-only by default**:

- **A. No public domain yet — local-only (recommended, implemented)** — `MAIN_VITE_API_URL` and `MAIN_VITE_UPDATE_FEED_URL` build-time env vars; empty = sign-in/changelog/updates simply unavailable, everything local works. When the control plane ships, set the vars (and the CSP host) — zero code changes.
- B. Reserve a domain now (e.g. `mauscode.dev` / `maus.dev`) and hardcode it — I cannot verify domain availability/ownership from here; provisioning is a maus-inc action.
- C. Ship the control plane as part of this repo immediately — out of scope for the identity workstream.

**Consequence:** which hosts appear in CSP, updater, auth; what users see when they click "Sign in" (today: a clear "control plane not configured" path).
**Implemented as:** A.

## D5 — Product term for external coding agents (⚠ public terminology)

Claude Code / Codex / OpenCode / Hermes are secondary compatibility options in the product model. When the UI needs a group label:

- **A. "Compatibility agents" (recommended)** — precise, matches the architecture (adapter layer), no negative framing.
- B. "External agents" — accurate but neutral/dry.
- C. "Other agents" — simplest, slightly dismissive of products we deliberately support.

**Consequence:** future agent-picker UI grouping. **Implemented as:** reserved in `naming-system.md`; no current UI grouping exists, so nothing visible changes today.

## D6 — App version line (minor, ⚠ release policy)

The inherited `package.json` carries `0.0.72` (1Code's version). A new product could restart at `0.1.0`.

- **A. Keep `0.0.72` (recommended for now)** — no release pipeline exists yet; restarting the line is a release-engineering decision best made with the first real release (and is one line).
- B. Restart at `0.1.0` immediately.

**Implemented as:** A (version untouched).
