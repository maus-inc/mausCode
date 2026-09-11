# Naming (canonical — all agents)

Authority: MausAgent (identity). Full system: `.dump/rebrand/decisions/naming-system.md`.

- Company: **maus-inc** (lowercase, hyphen) — legal/copyright/package-author contexts.
- Product: **mausCode** — capital C, lowercase m. Never `MausCode`/`MAUSCODE` in prose or UI.
- Technical identifiers (commands, URL schemes, directory names, theme ids, env var values, client names): lowercase **mauscode** — e.g. `mauscode` CLI, `mauscode://` protocol, `~/.mauscode/`, `mauscode-dark`. This is identifier casing, not branding drift.
- Native runtime: **mausCode Runtime** (public) — built from the JCode foundation. "JCode" appears only in provenance (`UPSTREAM.md`, `NOTICE`), never in user-facing surfaces. Remote daemon when it ships: **mausCode Node**.
- External coding agents (Claude Code, Codex, OpenCode, Hermes, …): **compatibility agents**; each keeps its own official product name.
- 1Code / 21st.dev: allowed only in `UPSTREAM.md`, `NOTICE`, README "Origin & Attribution", the historical chat-context document, and clearly-commented legacy-detection code.
- Keep inherited stable terms: project, session, worktree, provider, BYOK, MCP, skills.
- Data locations: `~/.mauscode/worktrees/`, `~/.mauscode/repos/`, `.mauscode/worktree.json` (legacy `~/.21st/...` and `.1code/...` are detected read-only, never written).
- Control plane / update CDN: not yet public — configured via `MAIN_VITE_API_URL` / `MAIN_VITE_UPDATE_FEED_URL`, empty by default (local-only). Do not hardcode any host until the domain decision lands.
