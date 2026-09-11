# cursor backend adapter (mausCode-authored, NOT a port)

Drives `agent -p --output-format stream-json --stream-partial-output`
(one process per turn, resumed via `--resume <chatId>`). No upstream code
is vendored; the CLI is resolved via PATH (`resolveCursorAgentCliLaunch`).

## Protocol notes (researched 2026-09-11)

- Events (one JSON object per stdout line): `system` (init carries
  `session_id`), `user` (prompt echo, skipped), `assistant`
  (`message.content[]` text blocks), `tool_call`
  (`started`/`completed`), `result` (`subtype`, `is_error`,
  `duration_ms`). `thinking`/`status` and future types are ignored.
- Partial streaming: deltas carry `timestamp_ms` WITHOUT `model_call_id`;
  buffered flushes (pre-tool-call, end-of-turn) repeat text and are
  skipped. Older CLIs emit snapshot messages; only the unseen suffix is
  kept. (cursor.com/docs/cli/reference/output-format)
- Tools: `{readToolCall|writeToolCall|editToolCall|shellToolCall|
  grepToolCall|globToolCall|lsToolCall|todoToolCall|updateTodosToolCall|
  deleteToolCall|...: {args, result?}}` or `{function: {name, arguments}}`
  (MCP/generic). Results unwrap `{success}` / `{error}` /
  `{rejected: {reason}}`. started/completed correlate by `call_id`, with
  oldest-open-first fallback when it is missing.
- Terminal `result` settles the turn; failures exit non-zero with a
  stderr message and may end the stream early without `result`. A clean
  exit without `result` still completes with whatever streamed.
- No usage/token fields exist anywhere in the protocol (capability
  `usageSurface: "none"`).
- Print runs only *propose* file changes unless approved: edit/agent
  pass `--force`, turbo passes `--yolo`; `--trust` keeps headless runs
  from pausing on workspace trust. plan/ask map to `--mode=plan|ask`
  (print accepts no `--mode=agent` value; Agent is the default).
- Resume: stdout `session_id` is captured per turn and passed back via
  `--resume`. A stale id (chat deleted, cache cleared, another machine)
  retries once as a fresh turn; unknown flags (older `agent` builds)
  retry once with the stable subset. Both failures happen pre-run, so
  retries are side-effect free. `--resume=-1`/latest is deliberately
  never used (it could hijack an unrelated chat).
- Prompts over 8000 chars travel on stdin (`agent -p` reads a piped
  prompt) to stay under OS command-line limits (Windows ~32KB).
- MCP auto-loads from mcp.json every turn (fresh process, no caching);
  images travel as prompt path references staged per turn.
- Cancel kills the child (SIGTERM, SIGKILL after 2s); print mode has no
  abort API. In headless runs Cursor auto-answers AskQuestion with a
  synthetic "questions skipped" result (upstream behavior, HAPI #784).
- Sandbox settings persist across sessions; the adapter passes no
  `--sandbox` flag (Cursor default applies).

## Chunk mapping

Single text trio per turn (deltas across tool calls share one block);
tool trio per call (`Read`/`Write`/`Edit`/`Bash`/`Grep`/`Glob`/`LS`/
`TodoWrite`/`Task`/`Delete`/`WebSearch`/`WebFetch` aliases, else the
native name) feeding `tool-<Name>` parts; tool errors surface as tool
output (the turn continues). Turn errors emit one `error` chunk, mapped
to `auth-error` for login failures.

## Tests

`npx vitest run src/main/lib/cursor-print` (mock `agent` script, no
binary needed). Covers: full turn + flush-skipping + function tools,
snapshot dedup, exit-code/error-result paths, interrupt silence,
session-id capture, rejected results, missing-`call_id` correlation,
trailing-line flush, stdin prompts, and argv/flag mapping.

## Customization points

- `--sandbox enabled|disabled` is unset; pass it per mode only if product
  wants mausCode modes to override the user's persisted CLI setting.
- `agent ls` / `~/.cursor/chats` transcript scraping could backfill
  thread ids, but stdout capture is the only documented-ish channel.
- ACP (`cursor-agent acp`, JSON-RPC) remains available as an alternate
  transport if print mode ever loses resume or MCP fidelity.
