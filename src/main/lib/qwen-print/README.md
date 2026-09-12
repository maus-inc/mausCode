# qwen-print

Native headless turns over the QwenLM Qwen Code CLI
(`qwen --output-format stream-json`), mausCode-authored. Protocol facts
below were verified live against qwen-code v0.23.3 with a stub
OpenAI-compatible endpoint (see recon notes in
`.dump/app/backend-landscape-2026-09-11.md` §5); re-verify against a
new CLI before changing argv/projector behavior.

## Argv (`args.ts`)

- Positional prompt (`qwen [query..]`); `-p/--prompt` is deprecated
  upstream. Dash-leading prompts ride `--prompt=<text>` (equals form):
  the space form and the `--` separator both misparse live.
- Always: `--output-format stream-json --include-partial-messages
  --channel desktop`.
- Modes: plan → `--approval-mode plan` (read-only); ask →
  `--approval-mode default` + `--exclude-tools
  write_file,edit,notebook_edit,run_shell_command,monitor,agent,task,skill`
  (read-only without plan framing; dispatch denies excluded tools
  fail-closed); edit → `auto-edit`; agent → `auto`; turbo → `yolo`
  (stderr warning silenced via `QWEN_CODE_SUPPRESS_YOLO_WARNING=1`,
  reviewed: the UI shows the mode).
- Headless `default` auto-DENIES confirmation-requiring tools (no hang,
  no TTY prompt): `tool_result.is_error` + `result.permission_denials[]`.
- Auth rides per-run flags (`--auth-type`, `--openai-api-key`,
  `--openai-base-url`, `-m`); omitted when mausCode holds no
  credentials so the CLI resolves settings/env on its own.
- First turns pass a client-chosen `--session-id` UUID (the CLI
  persists it); later turns pass `--resume <id>`.
- Unknown-args retry: yargs prints `Unknown argument(s): …` to stderr
  with EMPTY stdout and exit 0; the fallback keeps prompt + auth +
  model + resume and drops channel/partials/excludes/dirs/budgets.

## Envelope (`session.ts`)

Qwen's stream-json IS the claude vocabulary, so projection reuses
`createTransformer` (`claude/transform.ts`) with a qwen pre-mapper:

- `system/init`: session id, `tools[]`, `mcp_servers[{name, status}]`
  (connected/disconnected → connected/failed), model, permission_mode.
- `stream_event`: Anthropic partials (message_start,
  content_block_start/delta/stop, message_stop) + a `goal_state` event
  on every run (ignored).
- `assistant`: text/tool_use blocks; `usage` is ZEROED and stripped so
  the real `result.usage` wins. Tool names are snake_case registry ids,
  renamed to canonical UI names (`TOOL_NAME_MAP`); `mcp__*` passes
  through.
- `user`: `tool_result` blocks (incl. permission-declined errors).
- `result`: subtype success/error_during_execution/…, `is_error`,
  `result` text, real `usage`, `num_turns`,
  `permission_denials[{tool_name, …}]` (surfaced as visible text —
  policy violations are never silent), `error.message`.

Completion ownership: the projector withholds `message-metadata` /
`finish-step` / `finish` (usage/finalTextId ride the turn result into
the router's single metadata emission); error results bypass the
transformer and surface as a held `{type:"error"}` chunk so the router
can retry (stale resume → fresh turn; unknown flags → subset).

## Exits

0 even for in-envelope errors. Empty stdout + stderr text = pre-run
failure. 130 SIGINT (`Operation cancelled.`), 143 SIGTERM, 53
`--max-session-turns` overrun, 55 budget abort. Cancel sends SIGINT,
escalates to SIGTERM then SIGKILL.

## Auth config (`auth-config.ts`)

`qwen auth` was removed upstream; auth is purely configuration
(`modelProviders`, `security.auth.selectedType`, `model.name`, `env`
fallbacks in `~/.qwen/settings.json`, plus env vars and the `.env`
discovery chain). The probe reports credential presence without
network calls; runtime auth errors stay authoritative. Key values are
never echoed. Qwen OAuth is discontinued upstream (legacy cache only).

## MCP config (`mcp-config.ts`)

`mcpServers` map reader over `~/.qwen/settings.json`,
`<project>/.qwen/settings.json`, and `<project>/.mcp.json`. Live
status comes from scraping `qwen mcp list` (human-only output, see
`../qwen-mcp.ts`). Values posture matches the grok/cursor backends:
env/header values feed MCP server spawning and are never logged; the
settings UI renders keys only.

## Tests

`args.test.ts` (argv + classifiers), `session.test.ts` (mock-CLI
turns), `auth-config.test.ts` (tmp-home probes), `mcp-config.test.ts`
(tmp-home readers). Run: `vitest run src/main/lib/qwen-print/`.
