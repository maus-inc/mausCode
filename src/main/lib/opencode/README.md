# opencode backend adapter (mausCode-authored, NOT a port)

Drives `opencode serve` (local HTTP + SSE) via the official
`@opencode-ai/sdk` (exact pin in package.json). No upstream code is vendored.

## Protocol notes (SDK 1.18.x, researched 2026-09-11)

- Spawn: `opencode serve --port <free> --hostname 127.0.0.1`, readiness via
  `GET /global/health`. Three spawn attempts (free-port races).
- Turn: `POST /session/:id/prompt_async` (204) -> SSE `GET /global/event`
  (`{directory, payload}` envelopes) -> `session.idle` settles the turn.
- Streaming: `message.part.updated` carries `{part, delta?}`; text deltas
  stream, tool parts snapshot through pending/running/completed/error.
- Errors: `session.error`; `MessageAbortedError` = interrupt (silent),
  everything else fails the turn. `session.status: retry` is transient.
- Permissions: `permission.updated` auto-replied `{response:"always"}`.
- Usage: native per `step-finish` part (tokens + cost); no polling.
- Resume: `GET /session/:id`, else create; mid-turn 404 recreates once.
- Model: `provider/model` split; anything else omits (server default).
- Images: `{type:"file", mime, filename, url:file://<temp path>}` parts (file:// URLs, like the TUI uploader; plain paths fail); the router
  stages base64 attachments under the OS temp dir per turn.

## Chunk mapping

Text trio per text part; tool trio per tool callID (`Bash`/`Edit`/`Read`/
`WebSearch`/`WebFetch`/`Task`/`TodoWrite`/`TodoRead` aliases, else native
name); reasoning accumulates into a `Thinking` trio; tool errors surface as
tool output (the turn continues). file/patch/snapshot/subtask/agent/retry/
compaction/step-start parts are skipped (opencode keeps the record).

## Tests

`npx vitest run src/main/lib/opencode` (in-process mock HTTP+SSE server; no
binary needed). Covers: full turn + usage + permission auto-reply, resume,
interrupt silence, error mapping.

## Customization points

- Agent selection (e.g. plan mode -> `plan` agent) is deliberately unset;
  verify agent names via `GET /agent` before enabling.
- `directory`-scoped multi-project servers: out of scope (one server per
  chat, spawned with the chat cwd).
- Bundling the opencode binary: MIT allows it; v1 resolves via PATH only.
