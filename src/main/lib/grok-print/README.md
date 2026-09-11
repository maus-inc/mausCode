# grok-print: native Grok Build headless turns

mausCode-authored adapter (no upstream port) driving the official `grok`
CLI over its documented headless surface:

```
grok -p <prompt> --output-format streaming-json [flags...]
```

Primary sources (all verified 2026-09-11):

- `14-headless-mode.md` (official user guide, xai-org/grok-build):
  flags, streaming-json event table, exit codes, interrupt/resume,
  `--prompt-file`, "headless does NOT read piped stdin".
- `02-authentication.md`: `grok login` (browser OAuth) /
  `--device-auth` / `grok logout`, `~/.grok/auth.json` (0600),
  `XAI_API_KEY` fallback, auth precedence.
- `07-mcp-servers.md`: `[mcp_servers.<name>]` in `~/.grok/config.toml`
  (+ project `.grok/config.toml`), `grok mcp list --json`.
- `11-custom-models.md`: `grok models`, `-m`, `[models] default`.
- `19-plan-mode.md`: plan mode is read-only except the plan file, even
  under always-approve.
- toolsbase cheat sheet: streaming-json type list
  (`text, thought, tool_call, tool_call_update, usage, plan,
  available_commands, end, error`; `end` always last, non-exhaustive).

## Layout

- `args.ts` — pure argv builder + retry matchers (unit-tested).
- `session.ts` — spawn + NDJSON project + interrupt (mock-tested).
- `test/fixtures/grok-print-mock.mjs` — scripted `grok` stand-in.

## Mode mapping

| mausCode mode | argv |
| --- | --- |
| plan | `--permission-mode plan` |
| ask | `--tools read_file,grep,list_dir,web_search,web_fetch` |
| edit / agent | `--always-approve` |
| turbo | `--always-approve --permission-mode bypassPermissions` |

Always: `--output-format streaming-json --no-auto-update`, plus
`GROK_DISABLE_AUTOUPDATER=1` in env. `--cwd` pins the project root
(grok discovers the git root upward from cwd).

Notes:

- `--always-approve`, `--yolo`, and
  `--permission-mode bypassPermissions` are the same mechanism
  (official doc). Turbo spells it explicitly; there is no stronger
  documented tier.
- Ask uses an allowlist (not plan mode) so no plan-file ceremony runs
  for plain questions. Tool IDs are the headless-doc internal IDs.
- `--reasoning-effort` is intentionally not passed: levels are
  per-model menu options and wrong levels error per model.
- Long prompts (>8000 chars) travel via `--prompt-file` (documented).
  Stdin is never used: grok documents that headless ignores piped
  stdin, so a stdin fallback would silently drop prompts.

## Stream mapping (`session.ts`)

- `text` → incremental text deltas (official wrapper consumes
  `event["data"]` the same way).
- `thought` → suppressed (never in the transcript).
- `tool_call` → tool-input trio; internal IDs mapped to canonical UI
  names (`read_file`→Read, `search_replace`→Edit,
  `run_terminal_cmd`/`bash`→Bash, `grep`/`grep_search`→Grep,
  `list_dir`→LS, `web_search`→WebSearch, `web_fetch`→WebFetch,
  `todo_write`→TodoWrite, `task`→Task, plan-mode tools kept raw).
  Unknown IDs pass through raw (the UI renders unknown tools
  generically). `use_tool` (MCP meta-tool) resolves to
  `mcp__server__tool` when the input carries a `server__tool` value.
- `tool_call_update` → progress updates (no `rawOutput`, running-ish
  status) ignored; first result/terminal update emits tool-output
  (at-most-once per id; missing ids correlate oldest-open-first).
  `failed`/`error` statuses emit `{ error }` outputs.
- `usage` → accumulated; `end.usage` wins when present.
- `plan` → rendered as `Plan:` text lines (plan content would
  otherwise be lost: headless has no plan-approval surface).
- `available_commands` / `max_turns_reached` / `auto_compact_*` →
  skipped. Unknown future types ignored (stream is non-exhaustive).
- `end` → terminal. `cancelled`→interrupted, `refusal`→error, all
  other stop reasons→completed. Carries sessionId/stopReason/usage/
  num_turns/modelUsage/cost.
- `error` → terminal failure (message + frozen spend).

## Sessions

First turns pass `-s <uuid>` (client-chosen, `crypto.randomUUID`),
so the id is known even when a run is interrupted before `end`
(the only event carrying the server-side id). Follow-ups pass
`-r <id>`. Never `-s` with `-r` (the CLI rejects it).

Interrupts send SIGTERM (grok saves session state; exits 143).
Exit 130/143 after interrupt settles `interrupted` and keeps the
session id for resume (`grok -p "continue" -r <id>`).

## Retry loop (router)

Pre-run failures retry once per class (same policy as cursor:
retries happen before any turn side effects complete):

- stale `-r` id → fresh run with a new `-s` uuid;
- invalid `-m` slug → drop `-m` (CLI default model);
- unknown flag → stable subset (`-p`, `--output-format`, `-m`,
  `-r`/`-s`, `--cwd`, `--always-approve`; `--prompt-file` rewritten
  to inline `-p`). Only index 0 is treated as the prompt flag, so a
  prompt *text* equal to `--prompt-file` passes through.

## Auth

`XAI_API_KEY` env (headless/CI) or `grok login` (browser OAuth at
auth.x.ai) / `grok login --device-auth` (prints URL + code, polls).
Session tokens cache in `~/.grok/auth.json` (0600, `GROK_HOME`
override); session token beats `XAI_API_KEY`, per-model
`[model.<name>] api_key` beats both. There is no `status`/`whoami`
subcommand, so auth state is probed from the documented credential
locations (auth.json token, `XAI_API_KEY`, config.toml model keys)
— a stale cached token reports connected until a turn fails, at
which point the auth-error flow opens the login modal.

## Binary resolution

`$GROK_BINARY` override → `$GROK_HOME/bin/grok` →
`~/.grok/bin/grok` → `grok` on PATH (`.exe` on Windows). The generic
`grok` name collides with community CLIs (superagent `grok-dev`,
etc.); when the resolved binary rejects official-only subcommands
(`version`, `mcp`), the router reports "not the official Grok Build
CLI" with the override hint instead of failing cryptically.
