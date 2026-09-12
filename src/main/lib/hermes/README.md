# hermes-agent backend (mausCode-authored, NOT a port)

Drives `hermes acp` (ACP stdio server) through the generic ACP path
(`@mcpc-tech/acp-ai-provider` + AI SDK), mirroring the cursor router. No
upstream code is vendored.

## Protocol notes (researched 2026-09-11)

- Launch: `hermes acp` preferred, `hermes-acp` fallback (PATH-only).
  Health: `hermes acp --check`; version: `hermes --version`.
- Handshake: `initialize` -> `session/new` (or `session/load` for resume)
  -> `session/prompt`; agent streams `session/update` notifications
  (NDJSON stdio). Model via `session/set_model` with server-default
  fallback. Prompt result `{stopReason:"end_turn"}` maps to finish/stop.
- Resume is process-scoped: ACP sessions live in the running server, so a
  restart invalidates stored ids (load fails; the turn errors honestly).
- Permissions: the ACP provider auto-selects the agent's first option per
  request — no mausCode prompt. Manifest reports `session-auto`.
- Usage: the provider reports all-`undefined` usage; manifest `none`.
- Images: AI-SDK file parts convert to ACP `image` blocks per protocol.
- MCP: hermes starts its `config.yaml` servers in ACP mode (CLI-owned; no
  mausCode MCP procedures — manage with `hermes mcp ...`).
- Terminal auth (`--setup`) is interactive: configure providers first via
  `hermes model`; mausCode never triggers it.

## Full-fidelity state access

`runCommand` exposes read-only subcommands only (status, cron, skills, mcp,
webhook, tools, memory, checkpoints, auth, config, plugins, approvals,
doctor, logs, and other inspectors — see `policy.ts`). State-changing
commands stay out. Gateway/channels/TUI/Electron remain Hermes-owned.

## Tests

`npx vitest run src/main/lib/hermes` (mock NDJSON ACP agent + policy,
launch, and manifest tests; no binary needed). The registry test stubs
electron/better-sqlite3, which don't exist in node-only envs.

## Customization points

- Host-owned MCP injection via `session/new` `mcpServers` is supported by
  the adapter; mausCode passes none (CLI-owned config wins).
- Fork (`session/fork`) exists in ACP but is unwired (manifest `false`).
- A skip-global-MCP marker env exists upstream; its name is unverified, so
  mausCode does not set it — Hermes starts its configured servers.
