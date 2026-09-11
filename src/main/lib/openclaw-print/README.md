# openclaw-print

Native-print driver for the OpenClaw CLI (`openclaw agent exec
--json`), mausCode-authored. All wire facts verified live against
openclaw CLI 2026.9.2 (upgrade nose: re-run the probes; error
envelopes especially).

## argv (args.ts)

```
openclaw agent exec --json --timeout <s> --cwd <dir> [--model <provider/model>] --message-file -
```

+ prompt on stdin.

- `agent exec` is the documented headless entry point (no Gateway).
- The prompt travels on stdin (`--message-file -`, live-verified),
  so dash-leading prompts can never parse as flags.
- Auth is ambient + environment: the held key rides in the spawn env
  while the ambient config (MCP, skills, harness) stays loaded.
  `--auth-env-only`/`--isolated` are NOT used (they load no config,
  dropping the user's MCP servers from the turn).
- Exec accepts no resume flag — continuity is transcript-in-prompt
  (`<conversation_history>` block, bounded upstream).
- No mode flag exists: plan/ask turns carry a read-only planning
  prefix in the prompt (built by the router, not here).

## JSON envelope (session.ts)

stdout carries ONE envelope object at settle time (no streaming):

- ok: `{ok:true,status:"ok",final,payloads,usage:{input,output,
  total},costUsd,assistantTurns,toolSummary,model,provider,
  sessionId}` (exit 0). `final` projects as one text triple.
- error/timeout: `{ok:false,status,final:"",payloads:[],model:null,
  provider:null,sessionId,error:{message,kind}}` (exit 1 / exit 2 —
  both live-verified).

`toolSummary` has counts + names only (no per-call I/O), so no tool
cards are synthesized. `sessionId` is debugging-only (not
resumable). stderr carries `[diagnostic]`/`[model-fallback/decision]`
progress lines; only the tail is kept, for error context. Empty or
unparseable stdout is an error (nothing streamed to keep).

## Auth (auth-config.ts)

Onboarding persists keys as PLAINTEXT auth profiles by default (per
docs); mausCode never runs it and never writes `~/.openclaw`. One
held credential (DB, encrypted) is injected per-run via the spawn
env. Ambient auth is probed with `models status --json` (live: exit
0, side-effect-free, honors $HOME). Only env-verified providers are
held: openai, anthropic, openrouter, xai.

## MCP (mcp-config.ts)

`openclaw mcp list --json` (live shape: `{name: definition}` map —
NOT the docs' `{path, servers[]}`) is the source of truth: the CLI
loader resolves JSON5/`$include`/migrations a file parse would miss.
Global-only (no project surface); mcporter servers
(`config/mcporter.json`) are NOT covered. env/headers values are read
(fetchers need them), never logged; the UI renders keys only.

## Spawning

`openclaw` is a direct node script on PATH (openclaw-binary.ts;
`$OPENCLAW_BINARY` override). SIGINT is slow/ignored by the CLI
(live: a blocked turn survived SIGINT), so `interrupt()` escalates to
SIGKILL after 3s; cancellation is detected via our own abort flag.

## Tests

`args.test.ts` (argv shapes, classifiers), `session.test.ts` +
`openclaw-print-mock.mjs` (replays REAL captured fixtures:
`openclaw-auth-error.json`, `openclaw-timeout.json`,
`openclaw-unknown-model.json`; success follows the documented stable
envelope with stdin echo), `auth-config.test.ts` (sanitized live
`models status` capture), `mcp-config.test.ts` (live `mcp list`
capture).
