# Migration / import system — research

Goal: a user with an existing agent setup (Claude/Codex/OpenCode/Hermes/Cursor/…)
points mausCode at their machine and gets Detect → Preview → Map → Confirm → Import.
Never silently mutate. Preserve user intent; record assumptions.

## Source inventory (paths verified against JCode import-core + this repo's config readers)

| Tool | Config / sessions | What we can take |
|---|---|---|
| Claude Code | `~/.claude.json`, `~/.claude/` (agents, skills, settings, history), per-project `.mcp.json` / `.claude/` | MCP servers, skills, agents, hooks, keybindings-ish prefs, session transcripts (`ResumeTarget::ClaudeCodeSession` parsers exist) |
| Codex | `~/.codex/` (config, sessions) | provider/model prefs, session transcripts (`CodexSession` parsers exist) |
| OpenCode | `opencode.json[c]`, `~/.config/opencode/`, `~/.local/share/opencode/` sessions | providers/models, agents, skills, MCP, theme-ish prefs, transcripts (`OpenCodeSession` parsers exist) |
| Cursor | `~/.cursor/`, workspace `.cursor/` | rules, MCP (`CursorSession` parsers exist) |
| Pi | session files | transcripts (`PiSession` parsers exist) |
| Hermes | `~/.hermes/config.yaml`, `~/.hermes/.env`, skills | terminal backend prefs → placement hints, skills, env allowlist posture |
| Generic | `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `.gitconfig`, shell rc API keys (read-only detect) | instructions, MCP, git identity, provider-endpoint hints |

JCode `crates/jcode-import-core` already parses Claude/Codex/OpenCode/Cursor/Pi
transcripts and `ResumeTarget` covers convert-then-resume. That is the engine seed.
Hermes YAML + Cursor rules + MCP JSON merging have no JCode counterpart yet — new code.

## Flow design

1. **Detect**: scan known paths (fast, no reads of file contents beyond headers/manifests
   where possible); produce `DetectedEnvironment[]` with tool, version signal, item
   counts (skills N, MCP M, sessions K, rules present/absent). `mauscode doctor`-adjacent.
2. **Preview**: per-source card showing exactly what would be created in mausCode
   (workspace settings, `~/.mauscode/` entries, provider refs — never key material).
3. **Map**: field-level mapping UI for the ambiguous parts (Claude model → mausCode
   route; MCP server name collisions; skill name collisions; "use JCode native" vs
   "keep foreign CLI via adapter" per workspace).
4. **Confirm**: explicit per-item checkboxes, defaulting to safe subset (instructions,
   skills, MCP names — not credentials, not auto-run hooks).
5. **Import**: transactional per workspace; write a manifest (`import-manifest.json`)
   recording source paths, hashes, mapping decisions, timestamp. Originals untouched
   (copy, never move). Rollback = delete created entries listed in manifest.

## Assumptions (must be documented to the user at import time)

- A1. Imported transcripts are **untrusted input**: mark provenance, render a banner,
  never auto-execute intents found in history (prompt-injection via history is real).
- A2. Credentials are **referenced, not copied**: import creates provider *routes*
  pointing at the user's existing stores; mausCode never duplicates key files.
- A3. Hooks from foreign tools are imported **disabled**; enabling is a separate
  explicit action (foreign `pre_tool` gates could otherwise break or over-permit).
- A4. MCP server name collisions resolve by namespacing (`claude:<name>`), never by
  overwriting; the map step shows collisions.
- A5. Model names map to *routes*, not literal models; if no equivalent route exists,
  the item is flagged "needs decision" and import proceeds without it.
- A6. Import is idempotent: re-running with the same manifest skips completed items.
- A7. Nothing phones home: detection runs locally; no source inventory leaves the
  machine (telemetry sees only "import completed with N items" if telemetry is on).

## Placement

- Detection + parsing: **native runtime** (needs fs access on the node's machine;
  remote workspaces import from *their* environment, not the laptop's).
- Preview/map/confirm UI: **application**.
- Manifest store: workspace metadata (DB now, daemon later).
- Foreign-CLI execution after import: **compatibility adapters**, per-workspace choice.

## MVP scope (when reached in phase order)

Detect + import for Claude + OpenCode only (best parser coverage), instructions/skills/
MCP/sessions, single local workspace. Codex/Hermes/Cursor follow. Full matrix is
explicitly post-MVP.
