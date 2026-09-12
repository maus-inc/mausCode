# cline-print

Native-print driver for the Cline CLI (`cline --json`), mausCode-authored.
All wire facts verified live against cline CLI v3.0.61 (upgrade nose:
re-run the probes below; the 3.x NDJSON vocabulary already differs from
the published docs).

## argv (args.ts)

```
cline -P <provider> -k <key> -m <model> [-p] [-c <cwd>] [-t <s>] --json -- <prompt>
```

- `-P/-k/-m`: per-run BYOK injection (key omitted for ollama/lmstudio).
- `-p`: plan mode for plan/ask turns; act modes run the default.
- `--` before the positional is load-bearing (dash-leading prompts
  fail with `unknown option` otherwise; `--json` rejects stdin prompts).
- `--id` resume is broken in every headless path (fails with
  "requires a prompt argument" even with a prompt, on failed AND
  completed sessions) — continuity is transcript-in-prompt
  (`<conversation_history>` block, bounded upstream).

## NDJSON envelope (session.ts)

Per line: `hook_event` (ignored lifecycle markers) | `agent_event`
(`iteration_start/end`, `content_start/end` for text deltas + tool
round-trips, `usage`, `done{reason}`, `error`) |
`run_result{finishReason,usage,durationMs}` | top-level `error`.

Tool calls arrive input-less: `content_start{tool}` is empty;
`content_end{tool}` carries `{toolCallId,toolName,output}` and
projects to input-available (`{}`) + output-available.

Exit codes are unreliable (success 0, `-t` overrun 1, agent errors
0-or-1, SIGINT-cancel 0, arg errors 0): completion status comes from
events; cancellation from our abort flag. stderr ALSO carries JSON
error lines and is parsed. `hook dispatch failed` lines are hub noise.

## Auth (auth-config.ts)

`cline auth` persists to `~/.cline/data/settings/providers.json`
(apiKey in PLAINTEXT). mausCode never writes it: one held credential
(DB, encrypted) is injected per-run via flags. `CLINE_DATA_DIR`
overrides the data dir. Local runtimes (ollama/lmstudio) need no key.

## MCP (mcp-config.ts)

Global `~/.cline/data/settings/cline_mcp_settings.json` (the path
`cline config mcp` actually reads — NOT the documented
`~/.cline/mcp.json`) + project `.cline/mcp.json`. `cline config mcp
--json` lists names only (no status/tools), so there is no scrape
layer: liveness comes from tool-fetch success. env/headers values are
read (fetchers need them), never logged; the UI renders keys only.

## Spawning

ALWAYS spawn the resolved DIRECT binary (cline-binary.ts): the npm
`cline` wrapper uses spawnSync without signal forwarding, so
SIGINT-cancel is ignored through it. Direct-spawned, the CLI dies
promptly on SIGINT (exit 0, truncated JSONL).

## Tests

`args.test.ts` (argv shapes, classifiers), `session.test.ts` +
`cline-print-mock.mjs` (replays REAL captured fixtures:
`test/fixtures/cline-text-turn.jsonl`, `cline-tool-turn.jsonl`),
`auth-config.test.ts`, `mcp-config.test.ts`.
